/**
 * 抠图工具 - 毛发级别精细抠图
 * 
 * 使用本地 AI 模PS 内置型进行智能分割，不依赖 功能
 * 
 * 支持二进制传输优化：
 * - 图像数据使用 Uint8Array 直传，避免 Base64 膨胀
 * - 参考 sd-ppp 设计
 */

import { Tool, ToolSchema } from '../types';
import { BinaryMessageType } from '../../core/binary-protocol';
import { BinaryMaskStore } from '../../core/binary-mask-store';
import { arrayBufferFromBytes, assertImageBytesSafeForPhotoshop } from '../../core/image-safety';
import {
    resizeGrayscaleMaskBilinear,
    resolveMattingMaskApplyPlan
} from '../../core/matting-mask-geometry';

const { app, core, action, imaging } = require('photoshop');

function findLayerById(container: any, id: number): any {
    for (const layer of container.layers || []) {
        if (layer.id === id) return layer;
        if (layer.layers) {
            const found = findLayerById(layer, id);
            if (found) return found;
        }
    }
    return null;
}

interface RemoveBackgroundParams {
    /** 抠图模式: 'ai' 使用 AI 模型（默认） */
    mode?: 'ai' | 'local';
    /** 目标图层 ID，不指定则使用当前选中图层 */
    layerId?: number;
    /** 是否创建新图层（保留原图层） */
    createNewLayer?: boolean;
    /** 是否添加蒙版而不是直接删除背景 */
    useMask?: boolean;
    /** AI 模型 ID（后续扩展用） */
    modelId?: string;
    /** 输出质量（0-100）或预设档位 */
    quality?: number | 'fast' | 'balanced' | 'quality';
    /** 目标描述（如"袜子"、"人物"等），用于语义分割 */
    targetPrompt?: string;
    /** 边缘细化模式 */
    edgeRefine?: 'refine-none' | 'refine-light' | 'refine-standard' | 'refine-hair';
    /** 导出到模型前的最长边像素，默认动态选择 */
    maxSize?: number;
    /** 对所有图层取样：导出目标图层边界内的文档复合图像（含背景上下文），蒙版仍应用到目标图层 */
    sampleAllLayers?: boolean;
}

export class RemoveBackgroundTool implements Tool {
    name = 'removeBackground';

    // WebSocket 客户端引用（用于二进制传输）
    private wsClient: any = null;
    
    // 二进制请求 ID 计数器
    private static binaryRequestIdCounter = 1;
    
    static generateBinaryRequestId(): number {
        const id = RemoveBackgroundTool.binaryRequestIdCounter++;
        if (RemoveBackgroundTool.binaryRequestIdCounter > 4294967000) {
            RemoveBackgroundTool.binaryRequestIdCounter = 1;
        }
        return id;
    }
    
    setWebSocketClient(client: any): void {
        this.wsClient = client;
    }

    private isLayerGroup(layer: any): boolean {
        return Boolean(layer && Array.isArray(layer.layers));
    }

    private uint8ArrayToBase64(bytes: Uint8Array): string {
        const chunkSize = 0x8000;
        let binaryString = '';
        for (let i = 0; i < bytes.length; i += chunkSize) {
            const chunk = bytes.subarray(i, i + chunkSize);
            binaryString += String.fromCharCode(...chunk);
        }
        return btoa(binaryString);
    }

    private normalizeQualityPreset(quality?: number | string): 'fast' | 'balanced' | 'quality' {
        if (typeof quality === 'string') {
            const normalized = quality.trim().toLowerCase();
            if (normalized === 'fast' || normalized === 'balanced' || normalized === 'quality') {
                return normalized;
            }
            return 'balanced';
        }

        if (typeof quality === 'number' && Number.isFinite(quality)) {
            if (quality >= 85) return 'quality';
            if (quality >= 60) return 'balanced';
            return 'fast';
        }

        return 'balanced';
    }

    private resolveExportMaxSize(maxSize: number | undefined, quality?: number | string): number {
        const requestedMaxSize = Number(maxSize);
        if (Number.isFinite(requestedMaxSize)) {
            return Math.max(512, Math.min(4096, Math.round(requestedMaxSize)));
        }

        const qualityPreset = this.normalizeQualityPreset(quality);
        if (qualityPreset === 'fast') {
            return 896;
        }
        if (qualityPreset === 'quality') {
            return 1280;
        }
        return 1024;
    }

    schema: ToolSchema = {
        name: 'removeBackground',
        description: '智能抠图 - 使用本地 AI 模型进行毛发级别精细抠图。',
        parameters: {
            type: 'object',
            properties: {
                mode: {
                    type: 'string',
                    enum: ['ai', 'local'],
                    description: '抠图模式: ai/local=使用本地AI模型(推荐,毛发级别)'
                },
                layerId: {
                    type: 'number',
                    description: '目标图层ID，不指定则使用当前选中图层'
                },
                createNewLayer: {
                    type: 'boolean',
                    description: '是否创建新图层保留原图（默认true）'
                },
                useMask: {
                    type: 'boolean',
                    description: '是否使用蒙版而非直接删除背景（默认false）'
                },
                modelId: {
                    type: 'string',
                    description: 'AI模型ID，用于指定使用哪个抠图模型（预留扩展）'
                },
                quality: {
                    type: 'number',
                    description: '输出质量 0-100；也兼容 fast/balanced/quality 预设'
                },
                targetPrompt: {
                    type: 'string',
                    description: '目标描述（如"袜子"、"人物"），用于语义分割精确识别目标'
                },
                edgeRefine: {
                    type: 'string',
                    enum: ['refine-none', 'refine-light', 'refine-standard', 'refine-hair'],
                    description: '边缘细化模式: refine-none=无细化, refine-light=轻微细化(推荐), refine-standard=标准细化, refine-hair=毛发细化'
                },
                maxSize: {
                    type: 'number',
                    description: '导出到模型前的最长边像素（512-4096；未指定时按质量档动态选择）'
                }
            }
        }
    };

    async execute(params: RemoveBackgroundParams): Promise<{
        success: boolean;
        message: string;
        newLayerId?: number;
        processingTime?: number;
        usedMode?: string;
        imageData?: string;
        layerId?: number;
        targetPrompt?: string;
        error?: string;
        fallbackReason?: string;
        originalWidth?: number;
        originalHeight?: number;
        originalLeft?: number;   // 抠图时的图层左边界位置
        originalTop?: number;    // 抠图时的图层顶部位置
        docWidth?: number;       // 文档宽度
        docHeight?: number;      // 文档高度
        // 二进制传输字段
        useBinaryTransfer?: boolean;
        binaryRequestId?: number;
        binaryImageWidth?: number;
        binaryImageHeight?: number;
    }> {
        const startTime = Date.now();
        const {
            mode: _mode = 'ai', // 预留用于不同处理模式
            layerId,
            createNewLayer: _createNewLayer = true, // 预留
            useMask: _useMask = false, // 预留
            modelId: _modelId = 'default', // 预留
            quality: requestedQuality = 90,
            targetPrompt = '',
            maxSize,
            sampleAllLayers = false
        } = params;

        const exportMaxSize = this.resolveExportMaxSize(maxSize, requestedQuality);

        try {
            const doc = app.activeDocument;
            if (!doc) {
                return {
                    success: false,
                    message: '请先打开一个文档',
                    error: 'NO_DOCUMENT'
                };
            }

            // 确定目标图层
            let targetLayerId = layerId;
            if (!targetLayerId) {
                const activeLayers = doc.activeLayers;
                if (!activeLayers || activeLayers.length === 0) {
                    return {
                        success: false,
                        message: '请先选择一个图层',
                        error: 'NO_LAYER_SELECTED'
                    };
                }
                targetLayerId = activeLayers[0].id;
            }

            // 验证图层存在
            const targetLayer = findLayerById(doc, targetLayerId);
            if (!targetLayer) {
                return {
                    success: false,
                    message: `未找到图层 ID: ${targetLayerId}`,
                    error: 'LAYER_NOT_FOUND'
                };
            }

            console.log(`[RemoveBackground] 开始处理图层: ${targetLayer.name} (ID: ${targetLayerId}), 模式: AI`);

            // 使用 AI 模型 - 获取图层图像数据发送给 Agent
            console.log('[RemoveBackground] 正在获取图层图像数据 (AI 模式)...');
            {
                // ==================== 二进制传输优化 ====================
                // 优先使用二进制传输（节省 ~33% 数据量）
                // 参考 Adobe 官方 imaging API: https://developer.adobe.com/photoshop/uxp/2022/ps_reference/media/imaging/
                
                let binaryImageData: { type: BinaryMessageType; data: Uint8Array; width: number; height: number } | null = null;
                let imageData = '';
                let exportError: Error | null = null;
                let useBinaryTransfer = false;
                const exportLayerGroup = this.isLayerGroup(targetLayer);
                
                if (exportLayerGroup) {
                    console.log('[RemoveBackground] Layer group detected; using binary copy-export path.');
                }

                if (this.wsClient) {
                    try {
                        // 复合取样优先：导出图层边界内的文档复合（模型可见完整背景上下文）
                        binaryImageData = sampleAllLayers
                            ? await this.getLayerImageDataBinary(targetLayerId, exportMaxSize, { composite: true })
                            : exportLayerGroup
                                ? await this.copyLayerAndExportBinary(targetLayerId)
                                : await this.getLayerImageDataBinary(targetLayerId, exportMaxSize);
                        if (binaryImageData && binaryImageData.data.length > 0) {
                            useBinaryTransfer = true;
                            console.log(`[RemoveBackground] Binary image ${binaryImageData.width}x${binaryImageData.height}, ${(binaryImageData.data.length / 1024).toFixed(0)}KB${sampleAllLayers ? ' (composite)' : ''}`);
                        }
                    } catch (binErr: any) {
                        exportError = binErr;
                        if (sampleAllLayers) {
                            console.warn('[RemoveBackground] 复合取样导出失败，回退为仅目标图层取样:', binErr.message);
                        } else {
                            console.log('[RemoveBackground] Binary export failed, trying binary copy-export fallback:', binErr.message);
                        }
                        try {
                            binaryImageData = sampleAllLayers
                                ? await this.getLayerImageDataBinary(targetLayerId, exportMaxSize)
                                : !exportLayerGroup
                                    ? await this.copyLayerAndExportBinary(targetLayerId)
                                    : null;
                            if (binaryImageData && binaryImageData.data.length > 0) {
                                useBinaryTransfer = true;
                                console.log(`[RemoveBackground] Binary fallback export ${binaryImageData.width}x${binaryImageData.height}, ${(binaryImageData.data.length / 1024).toFixed(0)}KB`);
                            }
                        } catch (copyBinErr: any) {
                            exportError = copyBinErr;
                            console.log('[RemoveBackground] Binary copy-export failed, fallback to Base64:', copyBinErr.message);
                        }
                    }
                }
                
                if (!useBinaryTransfer) {
                    try {
                        imageData = exportLayerGroup
                            ? await this.copyLayerAndExport(targetLayerId)
                            : await this.getLayerImageData(targetLayerId, exportMaxSize);
                    } catch (err: any) {
                        console.error('[RemoveBackground] Export failed:', err.message);
                        exportError = err;
                    }
                }
                
                if (!useBinaryTransfer && (exportError || !imageData || imageData.length < 100)) {
                    const errorReason = exportError?.message || '导出数据无效';
                    console.error(`[RemoveBackground] AI 模式获取图像失败: ${errorReason}`);
                    
                    return {
                        success: false,
                        message: `获取图层图像失败: ${errorReason}`,
                        error: 'IMAGE_EXPORT_FAILED',
                        processingTime: Date.now() - startTime,
                        usedMode: 'ai',
                        layerId: targetLayerId,
                        fallbackReason: errorReason
                    };
                }
                
                // 获取图层的实际尺寸和位置
                const layerBounds = targetLayer.bounds;
                const docWidth = Math.max(1, Math.round(doc.width));
                const docHeight = Math.max(1, Math.round(doc.height));

                // 复合取样导出的是画布内裁剪区域，回贴坐标需同样夹取；普通取样保持原始图层边界
                const boundLeft = sampleAllLayers ? Math.max(0, Math.round(layerBounds.left)) : Math.round(layerBounds.left);
                const boundTop = sampleAllLayers ? Math.max(0, Math.round(layerBounds.top)) : Math.round(layerBounds.top);
                const boundRight = sampleAllLayers ? Math.min(docWidth, Math.round(layerBounds.right)) : Math.round(layerBounds.right);
                const boundBottom = sampleAllLayers ? Math.min(docHeight, Math.round(layerBounds.bottom)) : Math.round(layerBounds.bottom);
                const originalWidth = Math.max(1, boundRight - boundLeft);
                const originalHeight = Math.max(1, boundBottom - boundTop);
                const originalLeft = boundLeft;
                const originalTop = boundTop;
                
                console.log(`[RemoveBackground] 图层: ${originalWidth}x${originalHeight}, 位置: (${originalLeft}, ${originalTop}), 文档: ${docWidth}x${docHeight}`);
                
                // 二进制传输：先发送二进制数据，再返回 JSON
                if (useBinaryTransfer && binaryImageData && this.wsClient) {
                    // 生成唯一请求 ID
                    const binaryRequestId = RemoveBackgroundTool.generateBinaryRequestId();
                    
                    // 发送二进制数据
                    this.wsClient.sendBinaryData(
                        binaryImageData.type,
                        binaryRequestId,
                        binaryImageData.width,
                        binaryImageData.height,
                        binaryImageData.data
                    );
                    
                    console.log(`[RemoveBackground] 发送二进制图像 requestId=${binaryRequestId}`);
                    
                    return {
                        success: true,
                        message: targetPrompt 
                            ? `正在识别并分割: ${targetPrompt}...`
                            : 'AI 抠图请求已准备，等待模型处理...',
                        processingTime: Date.now() - startTime,
                        usedMode: 'ai',
                        layerId: targetLayerId,
                        // 二进制传输标记
                        useBinaryTransfer: true,
                        binaryRequestId: binaryRequestId,
                        binaryImageWidth: binaryImageData.width,
                        binaryImageHeight: binaryImageData.height,
                        targetPrompt: targetPrompt,
                        originalWidth: originalWidth,
                        originalHeight: originalHeight,
                        originalLeft: originalLeft,
                        originalTop: originalTop,
                        docWidth: docWidth,
                        docHeight: docHeight
                    };
                }
                
                // Base64 回退
                console.log(`[RemoveBackground] 使用 Base64 传输: ${Math.round(imageData.length / 1024)}KB`);
                
                return {
                    success: true,
                    message: targetPrompt 
                        ? `正在识别并分割: ${targetPrompt}...`
                        : 'AI 抠图请求已准备，等待模型处理...',
                    processingTime: Date.now() - startTime,
                    usedMode: 'ai',
                    layerId: targetLayerId,
                    imageData: imageData,
                    targetPrompt: targetPrompt,
                    originalWidth: originalWidth,
                    originalHeight: originalHeight,
                    originalLeft: originalLeft,
                    originalTop: originalTop,
                    docWidth: docWidth,
                    docHeight: docHeight
                };
            }
        } catch (error: any) {
            console.error('[RemoveBackground] 错误:', error);
            return {
                success: false,
                message: `抠图失败: ${error.message || error}`,
                error: error.message || String(error)
            };
        }
    }

    /**
     * 获取图层的图像数据（优化版）
     * 
     * 参考 sd-ppp 设计优化：
     * 1. 使用 imaging.getPixels 获取像素
     * 2. 优先使用 JPEG 压缩（减少传输大小）
     * 3. 支持大图自动缩放
     * 4. 抠图场景默认限制为 1024 (模型常用输入尺寸)
     */
    private async getLayerImageData(layerId: number, maxSize: number = 1024): Promise<string> {
        const doc = app.activeDocument;
        if (!doc) throw new Error('No active document');

        const targetLayer = findLayerById(doc, layerId);
        let result = "";

        try {
            await core.executeAsModal(async () => {
                let targetSize: Record<string, number> = { height: maxSize };
                if (targetLayer) {
                    const bounds = targetLayer.boundsNoEffects || targetLayer.bounds;
                    const layerW = bounds.right - bounds.left;
                    const layerH = bounds.bottom - bounds.top;
                    if (layerW > 0 && layerH > 0) {
                        targetSize = layerW >= layerH 
                            ? { width: Math.min(maxSize, layerW) }
                            : { height: Math.min(maxSize, layerH) };
                    }
                }
                
                const pixelResult = await imaging.getPixels({
                    documentID: doc.id,
                    layerID: targetLayer?.id,
                    targetSize: targetSize as any
                });
                
                if (!pixelResult?.imageData) {
                    throw new Error('Unable to get pixel data');
                }
                
                const imgData = pixelResult.imageData;
                const actualWidth = imgData.width;
                const actualHeight = imgData.height;
                const components = imgData.components;
                
                console.log(`[RemoveBackground] Pixels ${actualWidth}x${actualHeight}, ${components} channels`);
                
                try {
                    const jpegBase64 = await imaging.encodeImageData({
                        imageData: imgData,
                        base64: true
                    });
                    
                    if (jpegBase64 && typeof jpegBase64 === "string") {
                        result = `data:image/jpeg;base64,${jpegBase64}`;
                        console.log(`[RemoveBackground] JPEG encoded ${(result.length / 1024).toFixed(0)}KB`);
                    }
                } catch (encodeError: any) {
                    console.log('[RemoveBackground] JPEG encode failed, using RAW:', encodeError.message);
                }
                
                if (!result) {
                    const rawData = await imgData.getData();
                    const pixelCount = actualWidth * actualHeight;
                    
                    let binaryString = "";
                    for (let i = 0; i < pixelCount * components; i++) {
                        binaryString += String.fromCharCode(rawData[i]);
                    }
                    const base64 = btoa(binaryString);
                    result = `RAW:${actualWidth}:${actualHeight}:${components}:${base64}`;
                    console.log(`[RemoveBackground] RAW payload ${(base64.length / 1024).toFixed(0)}KB`);
                }
                
                imgData.dispose();
                
            }, { commandName: 'DesignEcho: Export matting image' });
        } catch (error) {
            console.warn('[RemoveBackground] getPixels export failed, using copy-export fallback:', error instanceof Error ? error.message : error);
        }
        
        if (!result) {
            console.log('[RemoveBackground] Trying fallback: duplicate layer into temp document');
            result = await this.copyLayerAndExport(layerId);
        }

        if (!result) {
            throw new Error('All image export strategies failed');
        }
        
        return result;
    }

    async getLayerImageDataBinary(layerId: number, maxSize: number = 1024, options?: { composite?: boolean }): Promise<{
        type: BinaryMessageType;
        data: Uint8Array;
        width: number;
        height: number;
    }> {
        const doc = app.activeDocument;
        if (!doc) throw new Error('没有打开的文档');

        const targetLayer = findLayerById(doc, layerId);
        const composite = options?.composite === true;

        let result: { type: BinaryMessageType; data: Uint8Array; width: number; height: number } | null = null;

        await core.executeAsModal(async () => {
            // 官方文档：targetSize 只传一个维度时 PS 按比例缩放保持纵横比
            // 传两个维度会强制缩放到精确尺寸（破坏纵横比）
            // 策略：取图层长边对应的维度，让 PS 自动计算短边
            let targetSize: Record<string, number> = { height: maxSize };
            if (targetLayer) {
                const bounds = targetLayer.bounds;
                const layerW = bounds.right - bounds.left;
                const layerH = bounds.bottom - bounds.top;
                if (layerW > 0 && layerH > 0) {
                    targetSize = layerW >= layerH
                        ? { width: Math.min(maxSize, layerW) }
                        : { height: Math.min(maxSize, layerH) };
                    console.log(`[RemoveBackground] 图层 ${layerW}x${layerH}, targetSize=${JSON.stringify(targetSize)}${composite ? ' (复合取样)' : ''}`);
                }
            }

            const pixelOptions: Record<string, any> = {
                documentID: doc.id,
                targetSize: targetSize as any  // PS API 支持只传一个维度，TS 类型定义过严
            };
            if (composite && targetLayer) {
                // 复合取样：不传 layerID 即取文档复合像素；sourceBounds 裁剪到目标图层边界（夹取画布范围）
                const b = targetLayer.bounds;
                pixelOptions.sourceBounds = {
                    left: Math.max(0, Math.round(b.left)),
                    top: Math.max(0, Math.round(b.top)),
                    right: Math.min(Math.round(doc.width), Math.round(b.right)),
                    bottom: Math.min(Math.round(doc.height), Math.round(b.bottom))
                };
                if (pixelOptions.sourceBounds.right <= pixelOptions.sourceBounds.left
                    || pixelOptions.sourceBounds.bottom <= pixelOptions.sourceBounds.top) {
                    throw new Error('复合取样失败：目标图层完全在画布之外。');
                }
            } else {
                pixelOptions.layerID = targetLayer?.id;
            }

            const pixelResult = await imaging.getPixels(pixelOptions as any);
            
            if (!pixelResult?.imageData) {
                throw new Error('无法获取像素数据');
            }
            
            const imgData = pixelResult.imageData;
            const actualWidth = imgData.width;
            const actualHeight = imgData.height;
            const components = imgData.components;
            
            console.log(`[RemoveBackground] 二进制获取像素: ${actualWidth}x${actualHeight}, ${components} 通道`);
            
            // 优先使用 JPEG 编码
            try {
                const jpegData = await imaging.encodeImageData({
                    imageData: imgData,
                    base64: false  // 返回 ArrayBuffer 而不是 Base64
                });
                
                if (jpegData && jpegData instanceof ArrayBuffer) {
                    result = {
                        type: BinaryMessageType.JPEG,
                        data: new Uint8Array(jpegData),
                        width: actualWidth,
                        height: actualHeight
                    };
                    console.log(`[RemoveBackground] JPEG 二进制: ${(result.data.length / 1024).toFixed(0)}KB`);
                }
            } catch (encodeError: any) {
                console.log('[RemoveBackground] JPEG 编码失败，使用 RAW:', encodeError.message);
            }
            
            // 回退到 RAW RGB 格式
            if (!result) {
                const rawData = await imgData.getData();
                const pixelCount = actualWidth * actualHeight;
                
                // 提取 RGB 数据（不含 Alpha）
                const rgbData = new Uint8Array(pixelCount * 3);
                for (let i = 0; i < pixelCount; i++) {
                    rgbData[i * 3] = rawData[i * components];      // R
                    rgbData[i * 3 + 1] = rawData[i * components + 1];  // G
                    rgbData[i * 3 + 2] = rawData[i * components + 2];  // B
                }
                
                result = {
                    type: BinaryMessageType.RAW_RGB,
                    data: rgbData,
                    width: actualWidth,
                    height: actualHeight
                };
                console.log(`[RemoveBackground] RAW RGB 二进制: ${(result.data.length / 1024).toFixed(0)}KB`);
            }
            
            imgData.dispose();
            
        }, { commandName: 'DesignEcho: 二进制获取抠图图像' });

        if (!result) {
            throw new Error('二进制图像获取失败');
        }
        
        return result;
    }

    /**
     * 方法A: 使用 batchPlay Quick Export 导出图层为 PNG
     * 
     * 注意: 由于 UXP 临时文件夹权限问题，此方法可能失败
     * 失败时会自动尝试方法B (imaging.getPixels)
     */
    private async exportLayerAsBase64(layerId: number): Promise<string> {
        const uxp = require('uxp');
        const fs = uxp.storage.localFileSystem;
        const doc = app.activeDocument;
        if (!doc) throw new Error('没有打开的文档');
        
        let result = '';
        const currentDoc = doc;

        await core.executeAsModal(async () => {
            try {
                // 选中目标图层
                const layer = findLayerById(currentDoc, layerId);
                if (!layer) throw new Error(`未找到图层 ID: ${layerId}`);
                currentDoc.activeLayers = [layer];

                // 获取临时文件夹
                let tempFolder;
                try {
                    tempFolder = await fs.getTemporaryFolder();
                } catch (folderError: any) {
                    console.error('[RemoveBackground] 无法获取临时文件夹:', folderError.message);
                    throw new Error('无法获取临时文件夹');
                }
                
                const timestamp = Date.now();
                const baseName = `de_export_${timestamp}.png`;
                
                // 创建临时文件
                let tempFile;
                try {
                    tempFile = await tempFolder.createFile(baseName, { overwrite: true });
                } catch (fileError: any) {
                    console.error('[RemoveBackground] 无法创建临时文件:', fileError.message);
                    throw new Error('无法创建临时文件');
                }
                
                console.log('[RemoveBackground] 临时文件路径:', tempFile.nativePath);
                
                // 使用 createSessionToken 创建文件令牌
                let fileToken;
                try {
                    fileToken = await fs.createSessionToken(tempFile);
                } catch (tokenError: any) {
                    console.error('[RemoveBackground] 无法创建文件令牌:', tokenError.message);
                    // 尝试使用 nativePath
                    fileToken = tempFile.nativePath;
                }
                
                // 使用 exportDocument 导出文档
                const exportDesc: any = {
                        _obj: 'exportDocument',
                        using: {
                            _obj: 'pngFormat',
                            method: { _enum: 'pngMethod', _value: 'quick' },
                            PNGInterlaceType: { _enum: 'PNGInterlaceType', _value: 'PNGInterlaceNone' },
                        transparency: true
                        },
                        in: {
                        _path: fileToken,
                            _kind: 'local'
                        },
                        copy: true,
                        _options: { dialogOptions: 'dontDisplay' }
                };
                
                await action.batchPlay([exportDesc], { synchronousExecution: true });

                const targetFile = tempFile;

                // 读取导出的文件
                const fileData = await targetFile.read({ format: uxp.storage.formats.binary });
                let uint8Array: Uint8Array;
                if (fileData instanceof ArrayBuffer) {
                    uint8Array = new Uint8Array(fileData);
                } else {
                    const encoder = new TextEncoder();
                    uint8Array = encoder.encode(fileData as string);
                }

                result = this.uint8ArrayToBase64(uint8Array);
                    
                    // 清理临时文件
                try { await targetFile.delete(); } catch (e) {}
            } catch (e: any) {
                console.error('[RemoveBackground] exportLayerAsBase64 内部错误:', e.message);
                throw e;
            }
        }, { commandName: 'DesignEcho: 导出图层为PNG' });

        return result;
    }

    /**
     * 方法B: 使用 Imaging API 获取图层像素并编码为 JPEG Base64
     * 
     * 使用 imaging.getPixels + imaging.encodeImageData
     * 参考: https://developer.adobe.com/photoshop/uxp/2022/ps_reference/media/imaging/
     */
    private async getPixelsAsBase64(docId: number, maxSize: number): Promise<string> {
        let result = '';

        await core.executeAsModal(async () => {
            // 1. 获取像素数据
            const pixelData = await imaging.getPixels({
                documentID: docId,
                targetSize: { width: maxSize, height: maxSize }
            } as any);

            if (pixelData && pixelData.imageData) {
                const imageDataObj = pixelData.imageData;
                
                console.log(`[RemoveBackground] Imaging API: ${imageDataObj.width}x${imageDataObj.height}, ` +
                           `${imageDataObj.components}通道, ${imageDataObj.colorSpace}`);
                
                // 2. 使用 encodeImageData 编码为 JPEG Base64
                try {
                    const jpegBase64 = await imaging.encodeImageData({
                        imageData: imageDataObj,
                        base64: true
                    });
                    
                    if (jpegBase64 && typeof jpegBase64 === 'string') {
                        result = `data:image/jpeg;base64,${jpegBase64}`;
                        console.log(`[RemoveBackground] 方法B: JPEG ${Math.round(result.length / 1024)}KB`);
                    }
                } catch (encodeError) {
                    console.log('[RemoveBackground] encodeImageData 失败，使用 RAW 格式');
                    
                    // 回退到 RAW 格式
                    const rawData = await imageDataObj.getData();
                    const uint8Array = new Uint8Array(rawData.buffer);
                    const width = imageDataObj.width;
                    const height = imageDataObj.height;
                    
                    let binaryString = '';
                    for (let i = 0; i < uint8Array.length; i++) {
                        binaryString += String.fromCharCode(uint8Array[i]);
                    }
                    const base64Data = btoa(binaryString);
                    result = `RAW:${width}:${height}:${base64Data}`;
                }
                
                // 释放资源
                imageDataObj.dispose();
            }
        }, { commandName: 'DesignEcho: 获取画布像素' });

        return result;
    }

    /**
     * 方法C: 复制图层到新文档，然后导出整个新文档
     * 这是最通用的方法，适用于任何类型的图层
     */
    private async copyLayerAndExport(layerId: number): Promise<string> {
        const binaryExport = await this.exportLayerViaTempDocument(layerId);
        return this.uint8ArrayToBase64(binaryExport.data);
    }

    private async copyLayerAndExportBinary(layerId: number): Promise<{
        type: BinaryMessageType;
        data: Uint8Array;
        width: number;
        height: number;
    }> {
        const exported = await this.exportLayerViaTempDocument(layerId);
        console.log(`[RemoveBackground] Binary copy-export PNG: ${exported.width}x${exported.height}, ${(exported.data.length / 1024).toFixed(0)}KB`);
        return {
            type: BinaryMessageType.PNG,
            data: exported.data,
            width: exported.width,
            height: exported.height
        };
    }

    private async exportLayerViaTempDocument(layerId: number): Promise<{
        data: Uint8Array;
        width: number;
        height: number;
    }> {
        const uxp = require('uxp');
        const fs = uxp.storage.localFileSystem;
        const doc = app.activeDocument;
        if (!doc) throw new Error('没有打开的文档');
        
        let tempDoc: any = null;
        let tempFile: any = null;
        let exportedWidth = 0;
        let exportedHeight = 0;
        const originalDoc = doc;  // 捕获非空引用

        const exportHolder: { bytes: Uint8Array | null } = { bytes: null };
        await core.executeAsModal(async () => {
            try {
                // 选中目标图层
                const layer = findLayerById(originalDoc, layerId);
                if (!layer) throw new Error(`未找到图层 ID: ${layerId}`);
                originalDoc.activeLayers = [layer];

                // 获取图层边界
                const bounds = layer.boundsNoEffects || layer.bounds;
                const left = Number(bounds.left);
                const top = Number(bounds.top);
                const right = Number(bounds.right);
                const bottom = Number(bounds.bottom);
                const width = right - left;
                const height = bottom - top;
                exportedWidth = Math.max(1, Math.round(width));
                exportedHeight = Math.max(1, Math.round(height));

                // 复制图层到新文档
                await action.batchPlay([
                    {
                        _obj: 'duplicate',
                        _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }],
                        to: { _ref: 'document', _name: 'DesignEcho_Temp_Export' },
                        _options: { dialogOptions: 'dontDisplay' }
                    }
                ], { synchronousExecution: true });

                // 获取新文档
                tempDoc = app.activeDocument;

                // 裁剪到图层边界
                await action.batchPlay([
                    {
                        _obj: 'crop',
                        to: {
                            _obj: 'rectangle',
                            top: { _unit: 'pixelsUnit', _value: top },
                            left: { _unit: 'pixelsUnit', _value: left },
                            bottom: { _unit: 'pixelsUnit', _value: bottom },
                            right: { _unit: 'pixelsUnit', _value: right }
                        },
                        _options: { dialogOptions: 'dontDisplay' }
                    }
                ], { synchronousExecution: true });

                // 创建临时文件
                const tempFolder = await fs.getTemporaryFolder();
                const fileName = `designecho_layer_${Date.now()}.png`;
                tempFile = await tempFolder.createFile(fileName, { overwrite: true });

                // 保存为 PNG
                await action.batchPlay([
                    {
                        _obj: 'save',
                        as: {
                            _obj: 'PNGFormat',
                            PNGInterlaceType: { _enum: 'PNGInterlaceType', _value: 'PNGInterlaceNone' },
                            compression: 6
                        },
                        in: { _path: tempFile.nativePath, _kind: 'local' },
                        copy: true,
                        _options: { dialogOptions: 'dontDisplay' }
                    }
                ], { synchronousExecution: true });

                // 读取文件
                const fileData = await tempFile.read({ format: uxp.storage.formats.binary });
                exportHolder.bytes = new Uint8Array(fileData);

            } finally {
                // 关闭临时文档（不保存）
                if (tempDoc && tempDoc !== originalDoc) {
                    await tempDoc.closeWithoutSaving();
                }
                // 删除临时文件
                if (tempFile) {
                    try {
                        await tempFile.delete();
                    } catch (e) {
                        // 忽略
                    }
                }
                // 恢复原文档为活动文档
                if (originalDoc) {
                    app.activeDocument = originalDoc;
                }
            }
        }, { commandName: 'DesignEcho: 复制图层并导出' });

        const exportedBytes = exportHolder.bytes;
        if (!exportedBytes || exportedBytes.byteLength === 0) {
            throw new Error('复制图层导出失败');
        }

        return {
            data: exportedBytes,
            width: exportedWidth,
            height: exportedHeight
        };
    }

    /**
     * 将 Base64 蒙版应用到 Photoshop
     * 
     * 输出格式选项：
     * - 'selection': 创建选区
     * - 'mask': 添加图层蒙版
     * - 'channel': 创建 Alpha 通道
     * - 'layer': 创建带透明度的新图层
     */
    async applyMaskToPhotoshop(
        maskBase64: string,
        layerId: number,
        outputType: 'selection' | 'mask' | 'channel' | 'layer' = 'mask'
    ): Promise<{ success: boolean; error?: string }> {
        const uxp = require('uxp');
        const fs = uxp.storage.localFileSystem;
        const doc = app.activeDocument;
        
        if (!doc) return { success: false, error: '没有打开的文档' };

        try {
            await core.executeAsModal(async () => {
                // 1. 将蒙版保存为临时文件
                const tempFolder = await fs.getTemporaryFolder();
                const maskFileName = `designecho_mask_${Date.now()}.png`;
                const maskFile = await tempFolder.createFile(maskFileName, { overwrite: true });
                
                // 解码 Base64 并写入文件
                const binaryString = atob(maskBase64);
                const bytes = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                }
                await maskFile.write(bytes.buffer, { format: uxp.storage.formats.binary });

                // 2. 根据输出类型处理
                switch (outputType) {
                    case 'selection':
                        await this.loadMaskAsSelection(maskFile.nativePath);
                        break;
                    case 'mask':
                        await this.loadMaskAsLayerMask(maskFile.nativePath, layerId);
                        break;
                    case 'channel':
                        await this.loadMaskAsChannel(maskFile.nativePath);
                        break;
                    case 'layer':
                        await this.createLayerWithMask(maskFile.nativePath, layerId);
                        break;
                }

                // 3. 清理临时文件
                try {
                    await maskFile.delete();
                } catch (e) {
                    // 忽略
                }
            }, { commandName: 'DesignEcho: 应用蒙版' });

            return { success: true };
        } catch (error: any) {
            console.error('[RemoveBackground] 应用蒙版失败:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * 将蒙版加载为选区
     */
    private async loadMaskAsSelection(maskPath: string): Promise<void> {
        // 打开蒙版图像
        await action.batchPlay([
            {
                _obj: 'open',
                null: { _path: maskPath, _kind: 'local' },
                _options: { dialogOptions: 'dontDisplay' }
            }
        ], {});

        const maskDoc = app.activeDocument;

        // 全选并复制
        await action.batchPlay([
            { _obj: 'selectAll', _options: { dialogOptions: 'dontDisplay' } },
            { _obj: 'copyEvent', _options: { dialogOptions: 'dontDisplay' } }
        ], {});

        // 关闭蒙版文档
        await (maskDoc as any).closeWithoutSaving();

        // 粘贴为选区（通过 Alpha 通道）
        await action.batchPlay([
            {
                _obj: 'make',
                new: { _class: 'channel' },
                name: 'DesignEcho Mask',
                _options: { dialogOptions: 'dontDisplay' }
            },
            { _obj: 'paste', _options: { dialogOptions: 'dontDisplay' } },
            {
                _obj: 'set',
                _target: [{ _ref: 'channel', _property: 'selection' }],
                to: { _ref: 'channel', _name: 'DesignEcho Mask' },
                _options: { dialogOptions: 'dontDisplay' }
            }
        ], {});
    }

    /**
     * 将蒙版加载为图层蒙版
     */
    private async loadMaskAsLayerMask(maskPath: string, layerId: number): Promise<void> {
        const doc = app.activeDocument;
        if (!doc) throw new Error('没有文档');

        // 选中目标图层
        const layer = findLayerById(doc, layerId);
        if (layer) {
            doc.activeLayers = [layer];
        }

        // 先加载为选区
        await this.loadMaskAsSelection(maskPath);

        // 从选区创建图层蒙版
        await action.batchPlay([
            {
                _obj: 'make',
                new: { _class: 'channel' },
                at: { _ref: 'channel', _enum: 'channel', _value: 'mask' },
                using: { _enum: 'userMaskEnabled', _value: 'revealSelection' },
                _options: { dialogOptions: 'dontDisplay' }
            },
            {
                _obj: 'set',
                _target: [{ _ref: 'channel', _property: 'selection' }],
                to: { _enum: 'ordinal', _value: 'none' },
                _options: { dialogOptions: 'dontDisplay' }
            }
        ], {});
    }

    /**
     * 将蒙版加载为 Alpha 通道
     */
    private async loadMaskAsChannel(maskPath: string): Promise<void> {
        // 打开蒙版
        await action.batchPlay([
            {
                _obj: 'open',
                null: { _path: maskPath, _kind: 'local' },
                _options: { dialogOptions: 'dontDisplay' }
            }
        ], {});

        const maskDoc = app.activeDocument;

        // 全选复制
        await action.batchPlay([
            { _obj: 'selectAll', _options: { dialogOptions: 'dontDisplay' } },
            { _obj: 'copyEvent', _options: { dialogOptions: 'dontDisplay' } }
        ], {});

        await (maskDoc as any).closeWithoutSaving();

        // 创建新通道并粘贴
        await action.batchPlay([
            {
                _obj: 'make',
                new: { _class: 'channel' },
                name: 'DesignEcho Alpha',
                _options: { dialogOptions: 'dontDisplay' }
            },
            { _obj: 'paste', _options: { dialogOptions: 'dontDisplay' } },
            {
                _obj: 'set',
                _target: [{ _ref: 'channel', _property: 'selection' }],
                to: { _enum: 'ordinal', _value: 'none' },
                _options: { dialogOptions: 'dontDisplay' }
            }
        ], {});
    }

    /**
     * 使用蒙版创建新图层
     */
    private async createLayerWithMask(maskPath: string, originalLayerId: number): Promise<void> {
        const doc = app.activeDocument;
        if (!doc) throw new Error('没有文档');

        // 选中原图层
        const layer = findLayerById(doc, originalLayerId);
        if (!layer) throw new Error('找不到图层');
        doc.activeLayers = [layer];

        // 复制图层
        await action.batchPlay([
            {
                _obj: 'duplicate',
                _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }],
                _options: { dialogOptions: 'dontDisplay' }
            }
        ], {});

        // 重命名新图层
        await action.batchPlay([
            {
                _obj: 'set',
                _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }],
                to: { _obj: 'layer', name: `${layer.name} (抠图)` },
                _options: { dialogOptions: 'dontDisplay' }
            }
        ], {});

        // 添加蒙版
        await this.loadMaskAsSelection(maskPath);

        await action.batchPlay([
            {
                _obj: 'make',
                new: { _class: 'channel' },
                at: { _ref: 'channel', _enum: 'channel', _value: 'mask' },
                using: { _enum: 'userMaskEnabled', _value: 'revealSelection' },
                _options: { dialogOptions: 'dontDisplay' }
            },
            {
                _obj: 'set',
                _target: [{ _ref: 'channel', _property: 'selection' }],
                to: { _enum: 'ordinal', _value: 'none' },
                _options: { dialogOptions: 'dontDisplay' }
            }
        ], {});
    }

}

/**
 * 应用 AI 抠图结果工具
 * 支持多种输出格式：图层蒙版、选区、Alpha 通道、新图层
 */
export class ApplyMattingResultTool implements Tool {
    name = 'applyMattingResult';

    schema: ToolSchema = {
        name: 'applyMattingResult',
        description: '将 AI 抠图结果应用到 Photoshop，支持蒙版、选区、通道或新图层',
        parameters: {
            type: 'object',
            properties: {
                originalLayerId: {
                    type: 'number',
                    description: '原始图层ID'
                },
                mattedImageBase64: {
                    type: 'string',
                    description: 'AI 处理后的带透明背景的图像（Base64 PNG）'
                },
                maskImageBase64: {
                    type: 'string',
                    description: '蒙版图像（Base64 灰度 PNG）'
                },
                outputFormat: {
                    type: 'string',
                    enum: ['mask', 'selection', 'channel', 'layer'],
                    description: '输出格式：mask=图层蒙版, selection=选区, channel=Alpha通道, layer=新图层'
                },
                createNewLayer: {
                    type: 'boolean',
                    description: '是否创建新图层'
                }
            },
            required: ['originalLayerId']
        }
    };

    private readonly binaryMaskStore: BinaryMaskStore;

    constructor(binaryMaskStore: BinaryMaskStore = new BinaryMaskStore()) {
        this.binaryMaskStore = binaryMaskStore;
    }

    private normalizePixelDimension(value: number, fallback: number): number {
        const numeric = Number(value);
        if (!Number.isFinite(numeric) || numeric <= 0) {
            return Math.max(1, Math.round(fallback));
        }
        return Math.max(1, Math.round(numeric));
    }

    private normalizePixelOffset(value: number): number {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) {
            return 0;
        }
        return Math.round(numeric);
    }

    async execute(params: {
        originalLayerId: number;
        mattedImageBase64?: string;
        maskImageBase64?: string;
        outputFormat?: 'mask' | 'selection' | 'channel' | 'layer';
        createNewLayer?: boolean;
        deleteBackground?: boolean;  // 是否直接删除背景
        // 抠图时的图层位置（用于选区定位，避免用户移动图层后错位）
        originalLeft?: number;
        originalTop?: number;
        docWidth?: number;
        docHeight?: number;
        // 二进制传输参数
        useBinaryMask?: boolean;      // 是否使用二进制蒙版
        binaryRequestId?: number;     // 关联的二进制请求 ID
        maskWidth?: number;           // 蒙版宽度（二进制传输时使用）
        maskHeight?: number;          // 蒙版高度（二进制传输时使用）
    }): Promise<{
        success: boolean;
        message: string;
        newLayerId?: number;
        error?: string;
    }> {
        const { 
            originalLayerId, 
            mattedImageBase64, 
            maskImageBase64,
            outputFormat = 'mask',
            createNewLayer = false,
            deleteBackground = false,
            // 使用传入的位置信息（抠图时记录的），如果没有则后续从图层获取
            originalLeft,
            originalTop,
            docWidth: paramDocWidth,
            docHeight: paramDocHeight,
            // 二进制传输
            useBinaryMask = false,
            binaryRequestId,
            maskWidth: paramMaskWidth,
            maskHeight: paramMaskHeight
        } = params;

        try {
            const doc = app.activeDocument;
            if (!doc) {
                return { success: false, message: '没有打开的文档', error: 'NO_DOCUMENT' };
            }

            console.log(`[ApplyMattingResult] 输出格式: ${outputFormat}, 图层: ${originalLayerId}, 二进制模式: ${useBinaryMask}`);

            // ==================== 二进制蒙版处理 ====================
            let maskBytes: Uint8Array;
            let maskWidth: number = Number(paramMaskWidth || 0);
            let maskHeight: number = Number(paramMaskHeight || 0);
            let isPngMask = false;
            let isRawMask = false;

            if (useBinaryMask && binaryRequestId) {
                // 等待二进制蒙版数据
                console.log(`[ApplyMattingResult] 等待二进制蒙版: requestId=${binaryRequestId}`);
                try {
                    const binaryResult = await this.binaryMaskStore.waitFor(binaryRequestId, 60000);
                    maskBytes = binaryResult.data;
                    if (maskWidth > 0 && binaryResult.width > 0 && maskWidth !== binaryResult.width) {
                        throw new Error(
                            `二进制蒙版宽度不一致：请求为 ${maskWidth}，实际为 ${binaryResult.width}。`
                        );
                    }
                    if (maskHeight > 0 && binaryResult.height > 0 && maskHeight !== binaryResult.height) {
                        throw new Error(
                            `二进制蒙版高度不一致：请求为 ${maskHeight}，实际为 ${binaryResult.height}。`
                        );
                    }
                    maskWidth = binaryResult.width || maskWidth;
                    maskHeight = binaryResult.height || maskHeight;
                    
                    // 根据二进制消息类型设置标志
                    if (binaryResult.type === BinaryMessageType.RAW_MASK) {
                        isRawMask = true;
                        console.log(`[ApplyMattingResult] 收到 RAW_MASK 二进制蒙版: ${(maskBytes.length / 1024).toFixed(1)}KB, 尺寸: ${maskWidth}x${maskHeight}`);
                    } else {
                        isPngMask = true;
                        console.log(`[ApplyMattingResult] 收到 PNG 二进制蒙版: ${(maskBytes.length / 1024).toFixed(1)}KB, 尺寸: ${maskWidth}x${maskHeight}`);
                    }
                } catch (error: any) {
                    return { success: false, message: `等待二进制蒙版失败: ${error.message}`, error: 'BINARY_TIMEOUT' };
                }
            } else {
                // ==================== 传统 Base64 蒙版处理 ====================
                const maskData = maskImageBase64 || mattedImageBase64;
                if (!maskData) {
                    return { success: false, message: '没有蒙版或抠图数据', error: 'NO_DATA' };
                }

                // 解析蒙版数据
                let base64Data = maskData;
                
                // 检查是否是 PNG_MASK 格式: PNG_MASK:width:height:base64data
                if (base64Data.startsWith('PNG_MASK:')) {
                    const parts = base64Data.split(':');
                    if (parts.length >= 4) {
                        maskWidth = parseInt(parts[1]) || 0;
                        maskHeight = parseInt(parts[2]) || 0;
                        base64Data = parts.slice(3).join(':');
                        isPngMask = true;
                        console.log(`[ApplyMattingResult] PNG_MASK 格式: ${maskWidth}x${maskHeight}`);
                    }
                }
                // 检查是否是 RAW_MASK 格式: RAW_MASK:width:height:base64data
                else if (base64Data.startsWith('RAW_MASK:')) {
                    const parts = base64Data.split(':');
                    if (parts.length >= 4) {
                        maskWidth = parseInt(parts[1]) || 0;
                        maskHeight = parseInt(parts[2]) || 0;
                        base64Data = parts.slice(3).join(':');
                        isRawMask = true;
                        console.log(`[ApplyMattingResult] RAW_MASK 格式: ${maskWidth}x${maskHeight}`);
                    }
                }
                
                // 普通 data URL 格式
                if (base64Data.includes(',')) {
                    base64Data = base64Data.split(',')[1];
                }
                
                const binaryString = atob(base64Data);
                maskBytes = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) {
                    maskBytes[i] = binaryString.charCodeAt(i);
                }
            }

            let newLayerId: number | undefined;
            const uxp = require('uxp');
            const fs = uxp.storage.localFileSystem;

            await core.executeAsModal(async () => {
                // 找到原始图层
                const originalLayer = findLayerById(doc, originalLayerId);
                if (!originalLayer) {
                    throw new Error(`未找到原始图层 ID: ${originalLayerId}`);
                }
                const layerBounds = originalLayer.bounds;
                const layerWidth = this.normalizePixelDimension(layerBounds.right - layerBounds.left, 1);
                const layerHeight = this.normalizePixelDimension(layerBounds.bottom - layerBounds.top, 1);

                // 统一为正整数尺寸，缺失时回退到图层尺寸
                maskWidth = this.normalizePixelDimension(maskWidth, layerWidth);
                maskHeight = this.normalizePixelDimension(maskHeight, layerHeight);

                if (isRawMask) {
                    const resolved = this.resolveRawMaskGeometry(maskBytes, maskWidth, maskHeight, layerWidth, layerHeight);
                    if (!resolved) {
                        throw new Error(
                            `RAW 蒙版尺寸异常: ${maskBytes.length} bytes, width=${maskWidth}, height=${maskHeight}, fallback=${layerWidth}x${layerHeight}`
                        );
                    }
                    maskWidth = resolved.width;
                    maskHeight = resolved.height;
                }

                console.log(`[ApplyMattingResult] 蒙版尺寸: ${maskWidth}x${maskHeight}, PNG: ${isPngMask}, RAW: ${isRawMask}`);

                const needsCanvasSelection = isRawMask && (maskWidth !== layerWidth || maskHeight !== layerHeight);

                // 选中原始图层
                doc.activeLayers = [originalLayer];

                switch (outputFormat) {
                    case 'mask':
                        // PNG 蒙版需要先通过 PS 打开来获取像素数据
                        if (isPngMask) {
                            await this.applyPngMaskAsLayerMask(originalLayerId, maskBytes);
                        } else {
                            // Raw 格式可以直接使用 Imaging API
                            await this.applyRawMaskAsLayerMask(doc.id, originalLayerId, maskBytes, maskWidth, maskHeight);
                        }
                        console.log('[ApplyMattingResult] 图层蒙版已应用');
                        break;
                        
                    case 'selection':
                        // 使用 AI 蒙版创建选区
                        if (isRawMask) {
                            // 使用抠图时记录的位置（如果有），否则从当前图层获取
                            // 重要：使用抠图时的位置可以避免用户移动图层后选区错位
                            let layerLeft: number;
                            let layerTop: number;
                            let docWidth: number;
                            let docHeight: number;
                            
                            if (originalLeft !== undefined && originalTop !== undefined) {
                                // 使用抠图时记录的位置（推荐）
                                layerLeft = this.normalizePixelOffset(originalLeft);
                                layerTop = this.normalizePixelOffset(originalTop);
                                docWidth = this.normalizePixelDimension(paramDocWidth !== undefined ? paramDocWidth : doc.width, doc.width);
                                docHeight = this.normalizePixelDimension(paramDocHeight !== undefined ? paramDocHeight : doc.height, doc.height);
                                console.log(`[ApplyMattingResult] 使用抠图时记录的位置: left=${layerLeft}, top=${layerTop}`);
                            } else {
                                // 回退：从当前图层获取（可能导致错位）
                                const layerBounds = originalLayer.bounds;
                                layerLeft = this.normalizePixelOffset(layerBounds.left);
                                layerTop = this.normalizePixelOffset(layerBounds.top);
                                docWidth = this.normalizePixelDimension(doc.width, layerWidth);
                                docHeight = this.normalizePixelDimension(doc.height, layerHeight);
                                console.log(`[ApplyMattingResult] 使用当前图层位置: left=${layerLeft}, top=${layerTop} (警告：可能错位)`);
                            }
                            
                            console.log(`[ApplyMattingResult] 选区定位: left=${layerLeft}, top=${layerTop}, 文档尺寸: ${docWidth}x${docHeight}`);
                            
                            await this.createSelectionFromRawMask(
                                doc.id, 
                                maskBytes, 
                                maskWidth, 
                                maskHeight,
                                layerLeft,
                                layerTop,
                                docWidth,
                                docHeight,
                                needsCanvasSelection
                            );
                        } else {
                            throw new Error('无法创建选区：需要有效的蒙版数据');
                        }
                        
                        // 如果需要删除背景，反选并删除
                        if (deleteBackground) {
                            console.log('[ApplyMattingResult] 正在删除背景...');
                            // 反选
                            await action.batchPlay([
                                {
                                    _obj: 'inverse',
                                    _options: { dialogOptions: 'dontDisplay' }
                                }
                            ], {});
                            // 删除选区内容
                            await action.batchPlay([
                                {
                                    _obj: 'delete',
                                    _options: { dialogOptions: 'dontDisplay' }
                                }
                            ], {});
                            // 取消选区
                            await action.batchPlay([
                                {
                                    _obj: 'set',
                                    _target: [{ _ref: 'channel', _property: 'selection' }],
                                    to: { _enum: 'ordinal', _value: 'none' },
                                    _options: { dialogOptions: 'dontDisplay' }
                                }
                            ], {});
                            console.log('[ApplyMattingResult] 背景已删除');
                        } else {
                            console.log('[ApplyMattingResult] 选区已创建');
                        }
                        break;
                        
                    case 'channel':
                        // 创建 Alpha 通道
                        if (isRawMask) {
                            await this.createAlphaChannelFromRawMask(doc.id, maskBytes, maskWidth, maskHeight);
                        } else {
                            // PNG 格式使用临时文件方式
                            const tempFolder = await fs.getTemporaryFolder();
                            const tempFile = await tempFolder.createFile(`de_mask_${Date.now()}.png`, { overwrite: true });
                            const channelBuffer = maskBytes.buffer.slice(maskBytes.byteOffset, maskBytes.byteOffset + maskBytes.byteLength);
                            await tempFile.write(channelBuffer as ArrayBuffer, { format: uxp.storage.formats.binary });
                            await this.createAlphaChannel(tempFile.nativePath);
                            await tempFile.delete().catch(() => {});
                        }
                        console.log('[ApplyMattingResult] Alpha 通道已创建');
                        break;
                        
                    case 'layer':
                        // 创建新图层（带透明背景）
                        if (mattedImageBase64) {
                            const tempFolder2 = await fs.getTemporaryFolder();
                            newLayerId = await this.createNewLayerWithImage(
                                mattedImageBase64, 
                                originalLayer.name,
                                tempFolder2
                            );
                        } else {
                            // 复制图层并应用蒙版
                            newLayerId = await this.duplicateAndApplyMaskImaging(
                                doc.id, originalLayerId, maskBytes, maskWidth, maskHeight
                            );
                        }
                        console.log('[ApplyMattingResult] 新图层已创建');
                        break;
                }

                // 使用 Imaging API 无需额外清理
                
                // 强制刷新文档显示
                await this.forceRefreshDocument(doc.id);

            }, { commandName: 'DesignEcho: 应用抠图结果' });

            const formatNames: Record<string, string> = {
                'mask': '图层蒙版',
                'selection': '选区',
                'channel': 'Alpha 通道',
                'layer': '新图层'
            };

            // 如果是删除背景模式，返回特殊消息
            const resultMessage = deleteBackground 
                ? '背景已删除' 
                : `${formatNames[outputFormat]}已应用`;

            return {
                success: true,
                message: resultMessage,
                newLayerId
            };

        } catch (error: any) {
            console.error('[ApplyMattingResult] 错误:', error);
            return {
                success: false,
                message: `应用抠图结果失败: ${error.message}`,
                error: error.message
            };
        }
    }

    /**
     * 强制刷新文档显示
     * 解决蒙版应用后 UI 不刷新的问题
     */
    private async forceRefreshDocument(docId: number): Promise<void> {
        const doc = app.activeDocument;
        if (!doc) return;

        try {
            // 方法: 切换图层可见性强制刷新（最安全有效）
            if (doc.activeLayers.length > 0) {
                const layer = doc.activeLayers[0] as any;
                
                // 快速隐藏再显示
                await action.batchPlay([
                    {
                        _obj: 'hide',
                        null: [{ _ref: 'layer', _id: layer.id }],
                        _options: { dialogOptions: 'dontDisplay' }
                    }
                ], { synchronousExecution: true });
                
                await action.batchPlay([
                    {
                        _obj: 'show',
                        null: [{ _ref: 'layer', _id: layer.id }],
                        _options: { dialogOptions: 'dontDisplay' }
                    }
                ], { synchronousExecution: true });
            }
        } catch (e: any) {
            // 静默处理
        }
    }

    /**
     * 使用简化方式应用图层蒙版
     * 直接使用 batchPlay 添加蒙版，避免文件令牌问题
     */
    private async applyLayerMaskImaging(
        docId: number,
        layerId: number,
        maskBytes: Uint8Array,
        width: number,
        height: number
    ): Promise<void> {
        const safeWidth = this.normalizePixelDimension(width, 1);
        const safeHeight = this.normalizePixelDimension(height, 1);
        console.log(`[ApplyMattingResult] 应用蒙版 ${safeWidth}x${safeHeight}, 数据大小: ${maskBytes.length}`);

        // PNG 输入 fail closed：历史上这里只贴一个 revealAll 空白蒙版就当成功，
        // 等于"抠了个空气"。PNG 解码需要打开临时文档，已统一走 RAW_MASK 二进制路径。
        if (maskBytes[0] === 0x89 && maskBytes[1] === 0x50) {
            throw new Error('PNG 蒙版不再支持静默应用（历史行为是创建空白蒙版冒充成功）。请改用 RAW_MASK 二进制蒙版路径。');
        }

        try {
            // 1. 先添加一个空白蒙版
            await action.batchPlay([
                {
                    _obj: 'make',
                    new: { _class: 'channel' },
                    at: { _ref: 'channel', _enum: 'channel', _value: 'mask' },
                    using: { _enum: 'userMaskEnabled', _value: 'revealAll' },
                    _options: { dialogOptions: 'dontDisplay' }
                }
            ], {});

            // 2. 使用 putLayerMask 填充真实蒙版数据
            const maskImageData = await imaging.createImageDataFromBuffer(
                maskBytes,
                {
                    width: safeWidth,
                    height: safeHeight,
                    components: 1,
                    colorSpace: 'Grayscale',
                    colorProfile: 'Gray Gamma 2.2'
                }
            );

            await imaging.putLayerMask({
                documentID: docId,
                layerID: layerId,
                imageData: maskImageData
            });

            maskImageData.dispose();
            console.log('[ApplyMattingResult] 蒙版数据已填充');

        } catch (error: any) {
            console.error('[ApplyMattingResult] 应用蒙版失败:', error.message);
            // 不吞错：让调用方如实失败，而不是留着空白蒙版冒充成功
            throw new Error(`应用图层蒙版失败: ${error.message}`);
        }
    }

    /**
     * 通过临时文件应用图层蒙版（备用方法）
     */
    // applyLayerMaskViaTempFile 已移除，使用 applyRawMaskAsLayerMask 替代

    /**
     * 使用 Raw 数据通过 Imaging API 应用蒙版
     */
    private async applyRawMaskAsLayerMask(
        docId: number,
        layerId: number,
        maskBytes: Uint8Array,
        width: number,
        height: number
    ): Promise<void> {
        console.log(`[ApplyMattingResult] 使用 Imaging API 应用 Raw 蒙版: ${width}x${height}, 数据大小: ${maskBytes.length}`);
        
        // 调试：检查蒙版数据分布
        let minVal = 255, maxVal = 0, sum = 0;
        let blackCount = 0, whiteCount = 0, midCount = 0;
        for (let i = 0; i < Math.min(maskBytes.length, 100000); i++) {
            const val = maskBytes[i];
            if (val < minVal) minVal = val;
            if (val > maxVal) maxVal = val;
            sum += val;
            if (val < 10) blackCount++;
            else if (val > 245) whiteCount++;
            else midCount++;
        }
        const sampleSize = Math.min(maskBytes.length, 100000);
        console.log(`[ApplyMattingResult] 蒙版采样(${sampleSize}): min=${minVal}, max=${maxVal}, avg=${(sum/sampleSize).toFixed(1)}`);
        console.log(`[ApplyMattingResult] 分布: 黑(${blackCount}), 白(${whiteCount}), 中(${midCount})`);

        let maskImageData: any = null;

        try {
            // 验证当前文档和图层
            const doc = app.activeDocument;
            if (!doc) {
                throw new Error('没有活动文档');
            }
            
            // 重新获取图层以确保它存在
            let layer = findLayerById(doc, layerId);
            if (!layer) {
                console.warn(`[ApplyMattingResult] 未找到图层 ${layerId}，尝试使用当前激活图层`);
                if (doc.activeLayers.length > 0) {
                    layer = doc.activeLayers[0];
                    layerId = layer.id;
                    docId = doc.id;
                    console.log(`[ApplyMattingResult] 使用激活图层: ${layerId}`);
                } else {
                    throw new Error('没有可用的图层');
                }
            }
            
            // 检查图层边界
            let layerBounds = layer.bounds;
            let layerWidth = this.normalizePixelDimension(layerBounds.right - layerBounds.left, 1);
            let layerHeight = this.normalizePixelDimension(layerBounds.bottom - layerBounds.top, 1);
            const normalizedWidth = this.normalizePixelDimension(width, layerWidth);
            const normalizedHeight = this.normalizePixelDimension(height, layerHeight);
            console.log(`[ApplyMattingResult] 图层尺寸: ${layerWidth}x${layerHeight}, 蒙版尺寸: ${normalizedWidth}x${normalizedHeight}`);
            
            // 检查是否是背景图层 - 背景图层不支持蒙版，需要先转换
            if (layer.isBackgroundLayer) {
                console.log('[ApplyMattingResult] 检测到背景图层，先转换为普通图层...');
                await this.convertBackgroundToLayer(layer);
                // 转换后重新获取图层信息
                layer = doc.activeLayers[0];
                layerId = layer.id;
                layerBounds = layer.bounds;
                layerWidth = this.normalizePixelDimension(layerBounds.right - layerBounds.left, 1);
                layerHeight = this.normalizePixelDimension(layerBounds.bottom - layerBounds.top, 1);
                console.log(`[ApplyMattingResult] 转换完成，新图层ID: ${layerId}`);
            }
            
            const expectedSourceBytes = normalizedWidth * normalizedHeight;
            if (maskBytes.byteLength !== expectedSourceBytes) {
                throw new Error(
                    `RAW 蒙版数据不完整：收到 ${maskBytes.byteLength} bytes，` +
                    `${normalizedWidth}×${normalizedHeight} 需要 ${expectedSourceBytes} bytes。`
                );
            }

            const applyPlan = resolveMattingMaskApplyPlan(
                normalizedWidth,
                normalizedHeight,
                layerWidth,
                layerHeight
            );
            let applyMaskBytes = maskBytes;

            if (applyPlan.mode === 'reject-large-mismatch') {
                throw new Error(
                    `MASK_DIMENSION_MISMATCH：Agent 返回 ${normalizedWidth}×${normalizedHeight} 蒙版，` +
                    `目标图层为 ${layerWidth}×${layerHeight}。为避免 UXP 主线程长时间缩放大图，` +
                    '请重新执行抠图；若仍出现此错误，请重启 DesignEcho 后重试。'
                );
            }

            if (applyPlan.mode === 'compat-bilinear') {
                const resizeStart = Date.now();
                applyMaskBytes = resizeGrayscaleMaskBilinear(
                    maskBytes,
                    normalizedWidth,
                    normalizedHeight,
                    layerWidth,
                    layerHeight
                );
                console.warn(
                    `[ApplyMattingResult] 小图兼容 resize: ${normalizedWidth}x${normalizedHeight} → ` +
                    `${layerWidth}x${layerHeight} (${Date.now() - resizeStart}ms)`
                );
            } else {
                console.log(`[ApplyMattingResult] 蒙版尺寸匹配图层尺寸: ${normalizedWidth}x${normalizedHeight}，跳过 resize`);
            }

            // 在最终尺寸确定后只创建一次 PhotoshopImageData，避免大图 native buffer 重复分配。
            maskImageData = await imaging.createImageDataFromBuffer(
                applyMaskBytes,
                {
                    width: layerWidth,
                    height: layerHeight,
                    components: 1,
                    colorSpace: 'Grayscale' as const,
                    colorProfile: 'Gray Gamma 2.2'
                }
            );

            // 蒙版定位到图层的实际边界起点（非背景图层可能有偏移）
            const maskLeft = this.normalizePixelOffset(layerBounds.left);
            const maskTop = this.normalizePixelOffset(layerBounds.top);
            console.log(`[ApplyMattingResult] 准备应用蒙版到图层 ${layerId}, targetBounds=(${maskLeft},${maskTop})...`);
            
            // 应用蒙版（targetBounds 确保蒙版与图层对齐）
            await imaging.putLayerMask({
                documentID: docId,
                layerID: layerId,
                imageData: maskImageData,
                replace: true,
                targetBounds: { left: maskLeft, top: maskTop },
                commandName: 'DesignEcho: 应用 AI 蒙版'
            });

            console.log('[ApplyMattingResult] Imaging API 蒙版应用成功');
        } catch (e: any) {
            console.error('[ApplyMattingResult] Imaging API 失败:', e.message);
            throw e;  // 直接抛出错误，不回退到 PS 内置功能
        } finally {
            if (maskImageData) {
                try {
                    maskImageData.dispose();
                } catch (disposeError: any) {
                    console.warn(`[ApplyMattingResult] 释放蒙版 ImageData 失败: ${disposeError.message}`);
                }
            }
        }
    }

    /**
     * PNG 蒙版 fail closed：历史实现只创建空白 revealAll 蒙版就返回，等于冒充成功。
     * PNG 解码需要打开临时文档，已统一走 RAW_MASK 二进制蒙版路径。
     */
    private async applyPngMaskAsLayerMask(layerId: number, pngBytes: Uint8Array): Promise<void> {
        console.log(`[ApplyMattingResult] PNG 蒙版大小: ${(pngBytes.length / 1024).toFixed(0)}KB，目标图层: ${layerId}`);
        throw new Error('PNG 蒙版不再支持静默应用（历史行为是创建空白蒙版冒充成功）。请改用 RAW_MASK 二进制蒙版路径。');
    }

    /**
     * 将背景图层转换为普通图层
     */
    private async convertBackgroundToLayer(layer: any): Promise<void> {
        console.log('[ApplyMattingResult] 转换背景图层为普通图层');
        
        await action.batchPlay([
            {
                _obj: 'set',
                _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }],
                to: {
                    _obj: 'layer',
                    name: layer.name || '图层 0'
                },
                _options: { dialogOptions: 'dontDisplay' }
            }
        ], {});
    }

    /**
     * 尝试修复 RAW 蒙版几何信息，避免尺寸不一致导致的错误
     * 1) 首选使用传入 width/height；
     * 2) 回退到当前图层尺寸；
     * 3) 最后尝试一维正方形尺寸推断
     */
    private resolveRawMaskGeometry(
        maskBytes: Uint8Array,
        width: number,
        height: number,
        fallbackWidth: number,
        fallbackHeight: number
    ): { width: number; height: number } | null {
        const safeWidth = this.normalizePixelDimension(width, 1);
        const safeHeight = this.normalizePixelDimension(height, 1);
        const safeFallbackWidth = this.normalizePixelDimension(fallbackWidth, safeWidth);
        const safeFallbackHeight = this.normalizePixelDimension(fallbackHeight, safeHeight);

        const expectedLength = safeWidth > 0 && safeHeight > 0 ? safeWidth * safeHeight : 0;
        if (expectedLength > 0 && expectedLength === maskBytes.length) {
            return { width: safeWidth, height: safeHeight };
        }

        const fallbackLength = safeFallbackWidth > 0 && safeFallbackHeight > 0 ? safeFallbackWidth * safeFallbackHeight : 0;
        if (fallbackLength > 0 && fallbackLength === maskBytes.length) {
            console.log(
                `[ApplyMattingResult] RAW 蒙版尺寸未携带完整信息，使用图层尺寸回退: ${safeFallbackWidth}x${safeFallbackHeight}`
            );
            return { width: safeFallbackWidth, height: safeFallbackHeight };
        }

        const sqrt = Math.sqrt(maskBytes.length);
        if (Number.isFinite(sqrt) && Math.floor(sqrt) === sqrt) {
            console.log('[ApplyMattingResult] RAW 蒙版采用正方形尺寸推断解析:', sqrt);
            return { width: sqrt, height: sqrt };
        }

        return null;
    }

    /**
     * 从 Raw 蒙版数据创建选区
     * 
     * @param docId - 文档 ID
     * @param maskBytes - 蒙版数据（与图层尺寸相同）
     * @param width - 蒙版宽度（图层宽度）
     * @param height - 蒙版高度（图层高度）
     * @param layerLeft - 图层在文档中的左边界位置
     * @param layerTop - 图层在文档中的顶部边界位置
     * @param docWidth - 文档宽度
     * @param docHeight - 文档高度
     */
    private async createSelectionFromRawMask(
        docId: number,
        maskBytes: Uint8Array,
        width: number,
        height: number,
        layerLeft: number = 0,
        layerTop: number = 0,
        docWidth?: number,
        docHeight?: number,
        forceCanvas = false
    ): Promise<void> {
        const safeWidth = this.normalizePixelDimension(width, 1);
        const safeHeight = this.normalizePixelDimension(height, 1);
        const safeLayerLeft = this.normalizePixelOffset(layerLeft);
        const safeLayerTop = this.normalizePixelOffset(layerTop);
        const safeDocWidth = docWidth ? this.normalizePixelDimension(docWidth, safeWidth) : safeWidth;
        const safeDocHeight = docHeight ? this.normalizePixelDimension(docHeight, safeHeight) : safeHeight;

        console.log(`[ApplyMattingResult] 从 Raw 蒙版创建选区: ${safeWidth}x${safeHeight}, 图层位置: (${safeLayerLeft}, ${safeLayerTop}), 文档画布: ${safeDocWidth}x${safeDocHeight}`);
        
        try {
            const expectedLength = safeWidth * safeHeight;
            if (safeWidth <= 0 || safeHeight <= 0 || expectedLength !== maskBytes.length) {
                throw new Error(`Raw 蒙版尺寸与数据长度不匹配: ${safeWidth}x${safeHeight}, bytes=${maskBytes.length}`);
            }

            // 如果图层有偏移，需要创建文档尺寸的选区画布
            const hasOffset = forceCanvas || safeLayerLeft !== 0 || safeLayerTop !== 0;
            
            if (hasOffset && safeDocWidth > 0 && safeDocHeight > 0) {
                console.log(`[ApplyMattingResult] 创建文档尺寸的选区画布: ${safeDocWidth}x${safeDocHeight}`);
                
                // 创建文档尺寸的空白画布（全黑 = 不选中）
                const fullCanvasBytes = new Uint8Array(safeDocWidth * safeDocHeight);
                fullCanvasBytes.fill(0);  // 全部填充为 0（不选中）
                
                // 将蒙版数据复制到正确的位置
                for (let y = 0; y < safeHeight; y++) {
                    const srcRowStart = y * safeWidth;
                    const dstY = safeLayerTop + y;
                    
                    // 检查是否在文档范围内
                    if (dstY < 0 || dstY >= safeDocHeight) continue;
                    
                    for (let x = 0; x < safeWidth; x++) {
                        const dstX = safeLayerLeft + x;
                        
                        // 检查是否在文档范围内
                        if (dstX < 0 || dstX >= safeDocWidth) continue;
                        
                        const srcIdx = srcRowStart + x;
                        const dstIdx = dstY * safeDocWidth + dstX;
                        fullCanvasBytes[dstIdx] = maskBytes[srcIdx];
                    }
                }
                
                // 创建选区图像数据（文档尺寸）
                const selectionImageData = await imaging.createImageDataFromBuffer(
                    fullCanvasBytes,
                    {
                        width: safeDocWidth,
                        height: safeDocHeight,
                        components: 1,
                        colorSpace: 'Grayscale' as const,
                        colorProfile: ''
                    }
                );

                // 使用 putSelection 创建选区
                await imaging.putSelection({
                    documentID: docId,
                    imageData: selectionImageData,
                    replace: true,
                    commandName: 'DesignEcho: AI 选区'
                });

                selectionImageData.dispose();
                console.log('[ApplyMattingResult] 带偏移的选区创建成功');
                
            } else {
                // 无偏移，直接使用蒙版尺寸
                const selectionImageData = await imaging.createImageDataFromBuffer(
                    maskBytes,
                    {
                        width: safeWidth,
                        height: safeHeight,
                        components: 1,
                        colorSpace: 'Grayscale' as const,
                        colorProfile: ''
                    }
                );

                // 使用 putSelection 创建选区
                await imaging.putSelection({
                    documentID: docId,
                    imageData: selectionImageData,
                    replace: true,
                    commandName: 'DesignEcho: AI 选区'
                });

                selectionImageData.dispose();
                console.log('[ApplyMattingResult] Raw 蒙版选区创建成功');
            }
            
        } catch (error: any) {
            console.error('[ApplyMattingResult] Raw 蒙版选区失败:', error.message);
            throw error;  // 直接抛出错误，不回退到 PS 内置功能
        }
    }

    /**
     * 使用 Imaging API 创建选区
     */
    private async createSelectionImaging(
        docId: number,
        maskBytes: Uint8Array,
        width: number,
        height: number
    ): Promise<void> {
        const safeWidth = this.normalizePixelDimension(width, 1);
        const safeHeight = this.normalizePixelDimension(height, 1);
        console.log(`[ApplyMattingResult] 创建选区 ${safeWidth}x${safeHeight}`);
        
        try {
            // PNG 输入 fail closed：不允许静默回退到全选——后续删除/填充会作用整个画布
            if (maskBytes[0] === 0x89 && maskBytes[1] === 0x50) {
                throw new Error('PNG 蒙版不能用于创建选区（已禁止静默回退全选）。请改用 RAW_MASK 二进制蒙版路径。');
            }
            
            // 创建选区图像数据
            const selectionImageData = await imaging.createImageDataFromBuffer(
                maskBytes,
                {
                    width: safeWidth,
                    height: safeHeight,
                    components: 1,
                    colorSpace: 'Grayscale',
                    colorProfile: 'Gray Gamma 2.2'
                }
            );

            // 使用 putSelection 创建选区
            await imaging.putSelection({
                documentID: docId,
                imageData: selectionImageData,
                replace: true
            });

            selectionImageData.dispose();
            console.log('[ApplyMattingResult] 选区已创建');
            
        } catch (error: any) {
            console.error('[ApplyMattingResult] 创建选区失败:', error.message);
            // 不回退全选：选区不确定时继续操作会毁掉整个画布，必须诚实失败
            throw new Error(`创建选区失败: ${error.message}`);
        }
    }

    /**
     * 复制图层并使用 Imaging API 应用蒙版
     */
    private async duplicateAndApplyMaskImaging(
        docId: number,
        layerId: number,
        maskBytes: Uint8Array,
        width: number,
        height: number
    ): Promise<number> {
        // 1. 复制图层
        await action.batchPlay([
            {
                _obj: 'duplicate',
                _target: [{ _ref: 'layer', _id: layerId }],
                _options: { dialogOptions: 'dontDisplay' }
            }
        ], {});

        // 2. 获取新图层 ID
        const doc = app.activeDocument!;
        const newLayer = doc.activeLayers[0];
        newLayer.name = `${newLayer.name} (抠图)`;

        // 3. 应用蒙版
        await this.applyLayerMaskImaging(docId, newLayer.id, maskBytes, width, height);

        return newLayer.id;
    }

    /**
     * 从蒙版创建选区
     */
    private async createSelectionFromMask(maskFilePath: string): Promise<void> {
        // 打开蒙版图像
        await action.batchPlay([
            {
                _obj: 'open',
                null: { _path: maskFilePath, _kind: 'local' },
                _options: { dialogOptions: 'dontDisplay' }
            }
        ], {});

        // 基于亮度创建选区（白色=选中）
        await action.batchPlay([
            {
                _obj: 'set',
                _target: [{ _ref: 'channel', _property: 'selection' }],
                to: { _ref: 'channel', _enum: 'channel', _value: 'RGB' },
                _options: { dialogOptions: 'dontDisplay' }
            }
        ], {});

        // 复制选区到剪贴板（通过通道数据）
        await action.batchPlay([
            { _obj: 'copyEvent', _options: { dialogOptions: 'dontDisplay' } }
        ], {});

        // 关闭蒙版文档
        await action.batchPlay([
            {
                _obj: 'close',
                saving: { _enum: 'yesNo', _value: 'no' },
                _options: { dialogOptions: 'dontDisplay' }
            }
        ], {});

        // 在原文档中从剪贴板加载选区
        // 使用颜色范围命令创建选区
        await action.batchPlay([
            {
                _obj: 'colorRange',
                fuzziness: 0,
                colors: { _enum: 'colors', _value: 'highlights' },
                _options: { dialogOptions: 'dontDisplay' }
            }
        ], {});
    }

    /**
     * 从 Raw 蒙版数据创建 Alpha 通道
     */
    private async createAlphaChannelFromRawMask(
        docId: number,
        maskBytes: Uint8Array,
        width: number,
        height: number
    ): Promise<void> {
        const safeWidth = this.normalizePixelDimension(width, 1);
        const safeHeight = this.normalizePixelDimension(height, 1);
        console.log(`[ApplyMattingResult] 从 Raw 蒙版创建 Alpha 通道: ${safeWidth}x${safeHeight}`);
        
        try {
            // 先创建一个新的 Alpha 通道
            await action.batchPlay([
                {
                    _obj: 'make',
                    new: { _class: 'channel' },
                    name: 'DesignEcho Mask',
                    _options: { dialogOptions: 'dontDisplay' }
                }
            ], {});

            // 尝试使用 Imaging API 填充通道
            // 注意：putSelection 可以用于设置选区，但对于 Alpha 通道需要不同的方法
            // 我们先创建选区，然后从选区创建通道
            const selectionImageData = await imaging.createImageDataFromBuffer(
                maskBytes,
                {
                    width: safeWidth,
                    height: safeHeight,
                    components: 1,
                    colorSpace: 'Grayscale' as const,
                    colorProfile: ''
                }
            );

            // 使用 putSelection 创建选区
            await imaging.putSelection({
                documentID: docId,
                imageData: selectionImageData,
                replace: true,
                commandName: 'DesignEcho: AI 选区'
            });

            selectionImageData.dispose();

            // 将选区存储到通道
            await action.batchPlay([
                {
                    _obj: 'set',
                    _target: [{ _ref: 'channel', _name: 'DesignEcho Mask' }],
                    to: { _ref: 'channel', _property: 'selection' },
                    _options: { dialogOptions: 'dontDisplay' }
                },
                {
                    _obj: 'set',
                    _target: [{ _ref: 'channel', _property: 'selection' }],
                    to: { _enum: 'ordinal', _value: 'none' },
                    _options: { dialogOptions: 'dontDisplay' }
                }
            ], {});
            
            console.log('[ApplyMattingResult] Raw 蒙版 Alpha 通道创建成功');
            
        } catch (error: any) {
            console.error('[ApplyMattingResult] Raw 蒙版 Alpha 通道失败:', error.message);
            
            // 回退：只创建空通道
            try {
                await action.batchPlay([
                    {
                        _obj: 'make',
                        new: { _class: 'channel' },
                        name: 'DesignEcho Mask (空)',
                        _options: { dialogOptions: 'dontDisplay' }
                    }
                ], {});
                console.log('[ApplyMattingResult] 创建了空 Alpha 通道作为回退');
            } catch (fallbackError) {
                console.error('[ApplyMattingResult] 创建空通道也失败:', fallbackError);
            }
        }
    }

    /**
     * 创建 Alpha 通道（从文件）
     */
    private async createAlphaChannel(maskFilePath: string): Promise<void> {
        // 打开蒙版图像
        await action.batchPlay([
            {
                _obj: 'open',
                null: { _path: maskFilePath, _kind: 'local' },
                _options: { dialogOptions: 'dontDisplay' }
            }
        ], {});

        // 全选并复制
        await action.batchPlay([
            { _obj: 'selectAll', _options: { dialogOptions: 'dontDisplay' } },
            { _obj: 'copyEvent', _options: { dialogOptions: 'dontDisplay' } }
        ], {});

        // 关闭蒙版文档
        await action.batchPlay([
            {
                _obj: 'close',
                saving: { _enum: 'yesNo', _value: 'no' },
                _options: { dialogOptions: 'dontDisplay' }
            }
        ], {});

        // 创建新的 Alpha 通道
        await action.batchPlay([
            {
                _obj: 'make',
                new: { _class: 'channel' },
                name: 'DesignEcho Mask',
                _options: { dialogOptions: 'dontDisplay' }
            }
        ], {});

        // 粘贴到新通道
        await action.batchPlay([
            { _obj: 'paste', _options: { dialogOptions: 'dontDisplay' } },
            { _obj: 'deselect', _options: { dialogOptions: 'dontDisplay' } }
        ], {});
    }

    /**
     * 创建带抠图结果的新图层
     */
    private async createNewLayerWithImage(
        imageBase64: string, 
        originalName: string,
        tempFolder: any
    ): Promise<number> {
        const uxp = require('uxp');
        const timestamp = Date.now();
        const tempFile = await tempFolder.createFile(`de_result_${timestamp}.png`, { overwrite: true });
        
        let base64Data = imageBase64;
        if (base64Data.includes(',')) {
            base64Data = base64Data.split(',')[1];
        }
        
        const binaryString = atob(base64Data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        assertImageBytesSafeForPhotoshop(bytes, {
            formatHint: 'png',
            sourceLabel: `抠图结果图层「${originalName}」`
        });
        await tempFile.write(arrayBufferFromBytes(bytes), { format: uxp.storage.formats.binary });
        const sessionToken = await uxp.storage.localFileSystem.createSessionToken(tempFile);

        // 导入为新图层
        await action.batchPlay([
            {
                _obj: 'placeEvent',
                null: { _path: sessionToken, _kind: 'local' },
                freeTransformCenterState: { _enum: 'quadCenterState', _value: 'QCSAverage' },
                _options: { dialogOptions: 'dontDisplay' }
            }
        ], { synchronousExecution: true });

        const currentDoc = app.activeDocument!;
        const newLayer = currentDoc.activeLayers[0];
        newLayer.name = `${originalName} (抠图)`;

        // 栅格化
        try {
            await action.batchPlay([
                {
                    _obj: 'rasterizeLayer',
                    _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }],
                    _options: { dialogOptions: 'dontDisplay' }
                }
            ], {});
        } catch (e) {}

        try {
            await tempFile.delete();
        } catch (e) {}

        return newLayer.id;
    }

    /**
     * 复制图层并应用蒙版
     */
    private async duplicateAndApplyMask(layerId: number, maskFilePath: string): Promise<void> {
        // 复制图层
        await action.batchPlay([
            {
                _obj: 'duplicate',
                _target: [{ _ref: 'layer', _id: layerId }],
                _options: { dialogOptions: 'dontDisplay' }
            }
        ], {});

        // 获取新图层
        const currentDoc = app.activeDocument!;
        const newLayer = currentDoc.activeLayers[0];
        newLayer.name = `${newLayer.name} (抠图)`;

        // 添加空白蒙版（简化版）
        try {
            await action.batchPlay([
                {
                    _obj: 'make',
                    new: { _class: 'channel' },
                    at: { _ref: 'channel', _enum: 'channel', _value: 'mask' },
                    using: { _enum: 'userMaskEnabled', _value: 'revealAll' },
                    _options: { dialogOptions: 'dontDisplay' }
                }
            ], {});
        } catch (e: any) {
            console.log('[duplicateAndApplyMask] 添加蒙版失败:', e.message);
        }
    }

}

/**
 * 多目标语义分割结果应用工具
 * 创建图层组，并为每个分割目标创建单独的蒙版图层
 */
export class ApplyMultiMattingResultTool implements Tool {
    name = 'applyMultiMattingResult';

    private readonly binaryMaskStore: BinaryMaskStore;

    constructor(binaryMaskStore: BinaryMaskStore = new BinaryMaskStore()) {
        this.binaryMaskStore = binaryMaskStore;
    }

    schema: ToolSchema = {
        name: 'applyMultiMattingResult',
        description: '将多目标语义分割结果应用到 Photoshop，创建图层组并为每个目标创建蒙版图层',
        parameters: {
            type: 'object',
            properties: {
                originalLayerId: {
                    type: 'number',
                    description: '原始图层ID'
                },
                groupName: {
                    type: 'string',
                    description: '图层组名称'
                },
                masks: {
                    type: 'array',
                    description: '蒙版数据数组，每个元素包含 name 和 maskImageBase64',
                    items: {
                        type: 'object'
                    }
                },
                outputFormat: {
                    type: 'string',
                    enum: ['mask', 'selection'],
                    description: '输出格式：mask=图层蒙版, selection=选区'
                }
            },
            required: ['originalLayerId', 'masks']
        }
    };

    private async waitForBinaryMask(
        requestId: number,
        timeout: number = 30000
    ): Promise<{ width: number; height: number; data: Uint8Array } | null> {
        try {
            const payload = await this.binaryMaskStore.waitFor(requestId, timeout);
            return {
                width: payload.width,
                height: payload.height,
                data: payload.data
            };
        } catch (error: any) {
            console.warn(`[ApplyMultiMatting] 等待二进制蒙版失败 requestId=${requestId}: ${error.message}`);
            return null;
        }
    }

    async execute(params: {
        originalLayerId: number;
        groupName?: string;
        masks: Array<{
            name: string;
            maskImageBase64?: string;  // Base64 方式（兼容）
            binaryRequestId?: number;  // 二进制方式
            width?: number;
            height?: number;
        }>;
        useBinaryTransfer?: boolean;  // 是否使用二进制传输
        outputFormat?: 'mask' | 'selection';
    }): Promise<{
        success: boolean;
        message: string;
        groupId?: number;
        layerIds?: number[];
        error?: string;
    }> {
        const {
            originalLayerId,
            groupName = '语义分割结果',
            masks,
            useBinaryTransfer = false,
            outputFormat = 'mask'
        } = params;

        console.log(`[ApplyMultiMatting] 开始处理 ${masks.length} 个目标 (二进制传输: ${useBinaryTransfer})`);

        try {
            const doc = app.activeDocument;
            if (!doc) {
                return { success: false, message: '没有打开的文档', error: 'NO_DOCUMENT' };
            }

            // 查找原始图层
            const originalLayer = findLayerById(doc, originalLayerId);
            if (!originalLayer) {
                return { 
                    success: false, 
                    message: `未找到图层 ID: ${originalLayerId}`, 
                    error: 'LAYER_NOT_FOUND' 
                };
            }

            const createdLayerIds: number[] = [];
            
            // 如果使用二进制传输，先等待所有蒙版数据
            const binaryMaskData: Map<number, { width: number; height: number; data: Uint8Array }> = new Map();
            if (useBinaryTransfer) {
                for (const mask of masks) {
                    if (mask.binaryRequestId !== undefined) {
                        const data = await this.waitForBinaryMask(mask.binaryRequestId);
                        if (data) {
                            binaryMaskData.set(mask.binaryRequestId, data);
                            console.log(`[ApplyMultiMatting] 获取蒙版: ${mask.name} (${data.width}x${data.height})`);
                        }
                    }
                }
            }

            // 使用 executeAsModal 执行所有操作
            await core.executeAsModal(async () => {
                // 1. 为每个目标复制图层并应用蒙版
                for (let i = 0; i < masks.length; i++) {
                    const mask = masks[i];
                    console.log(`[ApplyMultiMatting] 处理目标 ${i + 1}/${masks.length}: ${mask.name}`);

                    // 选择原始图层
                    await action.batchPlay([
                        {
                            _obj: 'select',
                            _target: [{ _ref: 'layer', _id: originalLayerId }],
                            makeVisible: false,
                            _options: { dialogOptions: 'dontDisplay' }
                        }
                    ], {});

                    // 复制图层
                    await action.batchPlay([
                        {
                            _obj: 'duplicate',
                            _target: [{ _ref: 'layer', _id: originalLayerId }],
                            _options: { dialogOptions: 'dontDisplay' }
                        }
                    ], {});

                    // 获取新图层并重命名
                    const newLayer = doc.activeLayers[0];
                    newLayer.name = mask.name;
                    createdLayerIds.push(newLayer.id);

                    // 应用蒙版
                    if (outputFormat === 'mask') {
                        if (useBinaryTransfer && mask.binaryRequestId !== undefined) {
                            // 二进制方式
                            const binaryData = binaryMaskData.get(mask.binaryRequestId);
                            if (binaryData) {
                                await this.applyMaskToLayerFromBinary(newLayer.id, binaryData.data, binaryData.width, binaryData.height);
                            }
                        } else if (mask.maskImageBase64) {
                            // Base64 方式（兼容）
                        await this.applyMaskToLayer(newLayer.id, mask.maskImageBase64);
                        }
                    }
                }

                // 2. 选择所有创建的图层
                if (createdLayerIds.length > 0) {
                    // 先选择第一个图层
                    await action.batchPlay([
                        {
                            _obj: 'select',
                            _target: [{ _ref: 'layer', _id: createdLayerIds[0] }],
                            makeVisible: false,
                            _options: { dialogOptions: 'dontDisplay' }
                        }
                    ], {});

                    // 添加其他图层到选区
                    for (let i = 1; i < createdLayerIds.length; i++) {
                        await action.batchPlay([
                            {
                                _obj: 'select',
                                _target: [{ _ref: 'layer', _id: createdLayerIds[i] }],
                                selectionModifier: { _enum: 'selectionModifierType', _value: 'addToSelection' },
                                makeVisible: false,
                                _options: { dialogOptions: 'dontDisplay' }
                            }
                        ], {});
                    }

                    // 3. 创建图层组
                    await action.batchPlay([
                        {
                            _obj: 'make',
                            _target: [{ _ref: 'layerSection' }],
                            from: {
                                _ref: 'layer',
                                _enum: 'ordinal',
                                _value: 'targetEnum'
                            },
                            _options: { dialogOptions: 'dontDisplay' }
                        },
                        {
                            _obj: 'set',
                            _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }],
                            to: {
                                _obj: 'layer',
                                name: groupName
                            },
                            _options: { dialogOptions: 'dontDisplay' }
                        }
                    ], {});
                }
            }, { commandName: 'DesignEcho: 多目标语义分割' });

            // 获取图层组 ID
            const group = doc.activeLayers[0];
            const groupId = group?.id;

            return {
                success: true,
                message: `成功创建图层组 "${groupName}"，包含 ${masks.length} 个分割图层`,
                groupId,
                layerIds: createdLayerIds
            };

        } catch (error: any) {
            console.error('[ApplyMultiMatting] Error:', error);
            return {
                success: false,
                message: '多目标分割应用失败',
                error: error.message
            };
        }
    }

    /**
     * 为图层应用蒙版
     */
    private async applyMaskToLayer(layerId: number, maskBase64: string): Promise<void> {
        try {
            // 获取文档
            const doc = app.activeDocument;
            if (!doc) {
                console.error('[ApplyMask] 没有打开的文档');
                return;
            }

            // 解码蒙版数据
            const maskBuffer = this.base64ToUint8Array(maskBase64);
            const docWidth = doc.width;
            const docHeight = doc.height;
            const expectedSize = docWidth * docHeight;

            // 检查是否是 RAW 格式的蒙版数据
            if (maskBuffer.length === expectedSize) {
                console.log(`[ApplyMask] RAW 蒙版数据: ${docWidth}x${docHeight}`);
                
                // 使用 imaging API 创建选区
                const imageObj = await imaging.createImageDataFromBuffer(
                    maskBuffer,
                    {
                        width: docWidth,
                        height: docHeight,
                        components: 1,
                        colorSpace: 'Grayscale'
                    }
                );
                
                await imaging.putSelection({
                    documentID: doc.id,
                    imageData: imageObj
                });

                // 为当前选中的图层添加蒙版
                await action.batchPlay([
                    {
                        _obj: 'make',
                        new: { _class: 'channel' },
                        at: { _ref: 'channel', _enum: 'channel', _value: 'mask' },
                        using: { _enum: 'userMaskEnabled', _value: 'revealSelection' },
                        _options: { dialogOptions: 'dontDisplay' }
                    }
                ], {});

                // 取消选区
                await action.batchPlay([
                    {
                        _obj: 'set',
                        _target: [{ _ref: 'channel', _property: 'selection' }],
                        to: { _enum: 'ordinal', _value: 'none' },
                        _options: { dialogOptions: 'dontDisplay' }
                    }
                ], {});
            } else {
                // 蒙版数据格式不匹配，添加空白蒙版
                console.log(`[ApplyMask] 蒙版大小不匹配 (${maskBuffer.length} vs ${expectedSize})，添加空白蒙版`);
                await action.batchPlay([
                    {
                        _obj: 'make',
                        new: { _class: 'channel' },
                        at: { _ref: 'channel', _enum: 'channel', _value: 'mask' },
                        using: { _enum: 'userMaskEnabled', _value: 'revealAll' },
                        _options: { dialogOptions: 'dontDisplay' }
                    }
                ], {});
            }

        } catch (error: any) {
            console.error('[ApplyMask] 应用蒙版失败:', error.message);
            // 降级：添加空白蒙版
            try {
                await action.batchPlay([
                    {
                        _obj: 'make',
                        new: { _class: 'channel' },
                        at: { _ref: 'channel', _enum: 'channel', _value: 'mask' },
                        using: { _enum: 'userMaskEnabled', _value: 'revealAll' },
                        _options: { dialogOptions: 'dontDisplay' }
                    }
                ], {});
            } catch (e) {}
        }
    }
    
    /**
     * 从二进制数据应用蒙版到图层（无 Base64 编码开销）
     */
    private async applyMaskToLayerFromBinary(layerId: number, maskData: Uint8Array, width: number, height: number): Promise<void> {
        let imageObj: any = null;

        try {
            const doc = app.activeDocument;
            if (!doc) {
                console.error('[ApplyMaskBinary] 没有打开的文档');
                return;
            }

            console.log(`[ApplyMaskBinary] 应用蒙版: ${width}x${height}, ${maskData.length} bytes`);
            const expectedBytes = width * height;
            if (maskData.byteLength !== expectedBytes) {
                throw new Error(
                    `RAW 蒙版数据不完整：收到 ${maskData.byteLength} bytes，` +
                    `${width}×${height} 需要 ${expectedBytes} bytes。`
                );
            }
            
            // 使用 imaging API 创建选区
            imageObj = await imaging.createImageDataFromBuffer(
                maskData,
                {
                    width: width,
                    height: height,
                    components: 1,
                    colorSpace: 'Grayscale'
                }
            );
            
            await imaging.putSelection({
                documentID: doc.id,
                imageData: imageObj
            });

            // 为当前选中的图层添加蒙版
            await action.batchPlay([
                {
                    _obj: 'make',
                    new: { _class: 'channel' },
                    at: { _ref: 'channel', _enum: 'channel', _value: 'mask' },
                    using: { _enum: 'userMaskEnabled', _value: 'revealSelection' },
                    _options: { dialogOptions: 'dontDisplay' }
                }
            ], {});

            // 取消选区
            await action.batchPlay([
                {
                    _obj: 'set',
                    _target: [{ _ref: 'channel', _property: 'selection' }],
                    to: { _enum: 'ordinal', _value: 'none' },
                    _options: { dialogOptions: 'dontDisplay' }
                }
            ], {});
            
            console.log(`[ApplyMaskBinary] 蒙版应用成功`);

        } catch (error: any) {
            console.error('[ApplyMaskBinary] 应用蒙版失败:', error.message);
            // 降级：添加空白蒙版
            try {
                await action.batchPlay([
                    {
                        _obj: 'make',
                        new: { _class: 'channel' },
                        at: { _ref: 'channel', _enum: 'channel', _value: 'mask' },
                        using: { _enum: 'userMaskEnabled', _value: 'revealAll' },
                        _options: { dialogOptions: 'dontDisplay' }
                    }
                ], {});
            } catch (e) {}
        } finally {
            if (imageObj) {
                try {
                    imageObj.dispose();
                } catch (disposeError: any) {
                    console.warn(`[ApplyMaskBinary] 释放蒙版 ImageData 失败: ${disposeError.message}`);
                }
            }
        }
    }

    private base64ToUint8Array(base64: string): Uint8Array {
        const cleanBase64 = base64.replace(/^data:.*?;base64,/, '');
        const binaryString = atob(cleanBase64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes;
    }
}
