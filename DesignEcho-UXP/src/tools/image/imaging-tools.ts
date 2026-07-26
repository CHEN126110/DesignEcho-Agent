/**
 * DesignEcho - Imaging API 工具
 * 使用 Adobe UXP Imaging API 进行高性能图像处理
 * 
 * 参考文档: https://developer.adobe.com/photoshop/uxp/2022/ps_reference/media/imaging/
 */

const { app, core, action } = require('photoshop');
const imaging = require('photoshop').imaging;

/**
 * 图像数据接口
 */
export interface ImageData {
    buffer: ArrayBuffer;       // 像素数据
    width: number;
    height: number;
    components: number;        // 每像素分量数 (3=RGB, 4=RGBA)
    componentSize: number;     // 每分量位数 (8, 16, 32)
    colorSpace: string;        // "RGB" | "Grayscale" | "Lab"
    colorProfile: string;
    hasAlpha: boolean;
}

/**
 * 从图层获取像素数据
 * 使用 Imaging API 的 getPixels
 */
export async function getLayerPixels(
    layerId?: number,
    options: {
        targetSize?: { width: number; height: number };
        applyAlpha?: boolean;
    } = {}
): Promise<ImageData> {
    const doc = app.activeDocument;
    if (!doc) {
        throw new Error('没有打开的文档');
    }

    const layer = layerId 
        ? findLayerById(doc, layerId)
        : doc.activeLayers[0];
    
    if (!layer) {
        throw new Error('未找到指定图层');
    }

    console.log(`[ImagingTools] 获取图层像素: ${layer.name} (ID: ${layer.id})`);

    // 使用 Imaging API 获取像素
    const getPixelsOptions: any = {
        documentID: doc.id,
        layerID: layer.id,
        applyAlpha: options.applyAlpha ?? true
    };

    // 如果指定了目标尺寸，添加缩放
    if (options.targetSize) {
        getPixelsOptions.targetSize = options.targetSize;
    }

    // imaging.getPixels 必须在 executeAsModal 内执行
    let resultData: ImageData | null = null;
    
    await core.executeAsModal(async () => {
    const result = await imaging.getPixels(getPixelsOptions);
    const imageData = result.imageData;

    // 获取实际像素数据
    const pixelData = await imageData.getData();

    console.log(`[ImagingTools] 像素数据: ${imageData.width}x${imageData.height}, ` +
                `${imageData.components}通道, ${imageData.componentSize}bit`);

    // 确保返回 ArrayBuffer 类型
    const bufferSlice = pixelData.buffer.slice(pixelData.byteOffset, pixelData.byteOffset + pixelData.byteLength);

        resultData = {
        buffer: bufferSlice as ArrayBuffer,
        width: imageData.width,
        height: imageData.height,
        components: imageData.components,
        componentSize: imageData.componentSize,
        colorSpace: imageData.colorSpace,
        colorProfile: imageData.colorProfile,
        hasAlpha: imageData.hasAlpha
    };
        
        // 释放资源
        imageData.dispose();
    }, { commandName: 'DesignEcho: 获取图层像素' });

    if (!resultData) {
        throw new Error('获取图层像素失败');
    }
    
    return resultData;
}

/**
 * 将像素数据转换为 Base64 PNG
 * 用于发送到 Agent
 */
export async function pixelsToBase64(imageData: ImageData): Promise<string> {
    let base64Result = '';
    
    await core.executeAsModal(async () => {
    // 创建 PhotoshopImageData
    const psImageData = await imaging.createImageDataFromBuffer(
        new Uint8Array(imageData.buffer),
        {
            width: imageData.width,
            height: imageData.height,
            components: imageData.components,
            colorSpace: imageData.colorSpace as 'RGB' | 'Grayscale' | 'Lab',
            colorProfile: imageData.colorProfile || 'sRGB IEC61966-2.1'
        }
    );

    // 编码为 JPEG base64（UXP 目前只支持 JPEG）
    const base64Data = await imaging.encodeImageData({
        imageData: psImageData,
        base64: true
    });

    // 清理
    psImageData.dispose();

        base64Result = base64Data as string;
    }, { commandName: 'DesignEcho: 转换像素为 Base64' });

    return base64Result;
}

/**
 * 应用图层蒙版
 * 使用 Imaging API 的 putLayerMask
 */
export async function applyLayerMask(
    layerId: number,
    maskData: Uint8Array,
    width: number,
    height: number
): Promise<void> {
    const doc = app.activeDocument;
    if (!doc) {
        throw new Error('没有打开的文档');
    }

    console.log(`[ImagingTools] 应用图层蒙版: ${width}x${height} 到图层 ${layerId}`);

    // 创建灰度蒙版数据
    const maskImageData = await imaging.createImageDataFromBuffer(
        maskData,
        {
            width: width,
            height: height,
            components: 1,  // 蒙版是灰度
            colorSpace: 'Grayscale',
            colorProfile: 'Gray Gamma 2.2'
        }
    );

    // 应用蒙版到图层
    await core.executeAsModal(async () => {
        await imaging.putLayerMask({
            documentID: doc.id,
            layerID: layerId,
            imageData: maskImageData
        });
    }, { commandName: 'DesignEcho: 应用图层蒙版' });

    // 清理
    maskImageData.dispose();

    console.log('[ImagingTools] 图层蒙版已应用');
}

/**
 * 设置选区
 * 使用 Imaging API 的 putSelection
 */
export async function setSelection(
    maskData: Uint8Array,
    width: number,
    height: number,
    replace: boolean = true
): Promise<void> {
    const doc = app.activeDocument;
    if (!doc) {
        throw new Error('没有打开的文档');
    }

    console.log(`[ImagingTools] 设置选区: ${width}x${height}`);

    // 创建灰度选区数据
    const selectionImageData = await imaging.createImageDataFromBuffer(
        maskData,
        {
            width: width,
            height: height,
            components: 1,
            colorSpace: 'Grayscale',
            colorProfile: 'Gray Gamma 2.2'
        }
    );

    await core.executeAsModal(async () => {
        await imaging.putSelection({
            documentID: doc.id,
            imageData: selectionImageData,
            replace: replace,
            commandName: 'DesignEcho: 创建选区'
        });
    }, { commandName: 'DesignEcho: 创建选区' });

    // 清理
    selectionImageData.dispose();

    console.log('[ImagingTools] 选区已创建');
}

/**
 * 创建 Alpha 通道
 */
export async function createAlphaChannel(
    maskData: Uint8Array,
    width: number,
    height: number,
    channelName: string = 'DesignEcho Mask'
): Promise<void> {
    const doc = app.activeDocument;
    if (!doc) {
        throw new Error('没有打开的文档');
    }

    console.log(`[ImagingTools] 创建 Alpha 通道: ${channelName}`);

    await core.executeAsModal(async () => {
        // 1. 创建新通道
        await action.batchPlay([
            {
                _obj: 'make',
                new: { _class: 'channel' },
                name: channelName,
                _options: { dialogOptions: 'dontDisplay' }
            }
        ], {});

        // 2. 通道已创建，无需进一步操作
        // Alpha 通道创建后会自动显示在通道面板中
        console.log(`[ImagingTools] Alpha 通道 "${channelName}" 已创建`);

    }, { commandName: 'DesignEcho: 创建 Alpha 通道' });

    console.log('[ImagingTools] Alpha 通道已创建');
}

/**
 * 获取图层并转换为适合 Agent 处理的格式
 */
export async function getLayerForMatting(
    layerId?: number,
    maxSize: number = 2048
): Promise<{
    imageBase64: string;
    width: number;
    height: number;
    layerId: number;
    layerName: string;
}> {
    const doc = app.activeDocument;
    if (!doc) {
        throw new Error('没有打开的文档');
    }

    const layer = layerId 
        ? findLayerById(doc, layerId)
        : doc.activeLayers[0];
    
    if (!layer) {
        throw new Error('未找到指定图层');
    }

    // 获取图层边界
    const bounds = layer.bounds;
    const originalWidth = bounds.right - bounds.left;
    const originalHeight = bounds.bottom - bounds.top;

    // 计算目标尺寸（保持比例，不超过 maxSize）
    let targetWidth = originalWidth;
    let targetHeight = originalHeight;
    
    if (originalWidth > maxSize || originalHeight > maxSize) {
        const scale = Math.min(maxSize / originalWidth, maxSize / originalHeight);
        targetWidth = Math.round(originalWidth * scale);
        targetHeight = Math.round(originalHeight * scale);
    }

    console.log(`[ImagingTools] 获取图层 ${layer.name}: ${originalWidth}x${originalHeight} → ${targetWidth}x${targetHeight}`);

    // 获取像素
    const imageData = await getLayerPixels(layer.id, {
        targetSize: { width: targetWidth, height: targetHeight },
        applyAlpha: false
    });

    // 转换为 Base64
    const imageBase64 = await pixelsToBase64(imageData);

    return {
        imageBase64,
        width: originalWidth,
        height: originalHeight,
        layerId: layer.id,
        layerName: layer.name
    };
}

/**
 * 应用抠图结果
 * 根据输出格式选择不同的应用方式
 */
export async function applyMattingResult(
    layerId: number,
    maskBase64: string,
    outputFormat: 'mask' | 'selection' | 'channel' | 'layer',
    originalWidth: number,
    originalHeight: number
): Promise<{ success: boolean; message: string }> {
    try {
        // 解码 Base64 蒙版
        const maskBuffer = base64ToUint8Array(maskBase64);
        
        // 获取蒙版尺寸（假设是灰度图，每像素 1 字节）
        // 需要从 Agent 端传递实际的宽高
        const maskWidth = originalWidth;
        const maskHeight = originalHeight;

        switch (outputFormat) {
            case 'mask':
                await applyLayerMask(layerId, maskBuffer, maskWidth, maskHeight);
                return { success: true, message: '图层蒙版已应用' };

            case 'selection':
                await setSelection(maskBuffer, maskWidth, maskHeight, true);
                return { success: true, message: '选区已创建' };

            case 'channel':
                await createAlphaChannel(maskBuffer, maskWidth, maskHeight, 'DesignEcho Mask');
                return { success: true, message: 'Alpha 通道已创建' };

            case 'layer':
                // 创建新图层并应用蒙版
                await createLayerWithMask(layerId, maskBuffer, maskWidth, maskHeight);
                return { success: true, message: '新图层已创建' };

            default:
                return { success: false, message: `不支持的输出格式: ${outputFormat}` };
        }
    } catch (error: any) {
        console.error('[ImagingTools] 应用结果失败:', error);
        return { success: false, message: error.message };
    }
}

/**
 * 创建带蒙版的新图层
 */
async function createLayerWithMask(
    originalLayerId: number,
    maskData: Uint8Array,
    width: number,
    height: number
): Promise<void> {
    const doc = app.activeDocument;
    if (!doc) {
        throw new Error('没有打开的文档');
    }

    await core.executeAsModal(async () => {
        // 1. 复制原图层
        await action.batchPlay([
            {
                _obj: 'duplicate',
                _target: [{ _ref: 'layer', _id: originalLayerId }],
                _options: { dialogOptions: 'dontDisplay' }
            }
        ], {});

        // 2. 获取新图层
        const newLayer = doc.activeLayers[0];
        newLayer.name = `${newLayer.name} (抠图)`;

        // 3. 应用蒙版
        const maskImageData = await imaging.createImageDataFromBuffer(
            maskData,
            {
                width: width,
                height: height,
                components: 1,
                colorSpace: 'Grayscale',
                colorProfile: 'Gray Gamma 2.2'
            }
        );

        await imaging.putLayerMask({
            documentID: doc.id,
            layerID: newLayer.id,
            imageData: maskImageData
        });

        maskImageData.dispose();

    }, { commandName: 'DesignEcho: 创建抠图图层' });
}

/**
 * Base64 转 Uint8Array
 */
function base64ToUint8Array(base64: string): Uint8Array {
    // 移除 data URL 前缀
    let data = base64;
    if (data.includes(',')) {
        data = data.split(',')[1];
    }

    const binaryString = atob(data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
}

/**
 * 按 ID 查找图层
 */
function findLayerById(container: any, id: number): any {
    for (const layer of container.layers) {
        if (layer.id === id) {
            return layer;
        }
        if (layer.layers) {
            const found = findLayerById(layer, id);
            if (found) return found;
        }
    }
    return null;
}

/**
 * 导出工具供 MCP 使用
 */
export const ImagingTools = {
    getLayerPixels,
    pixelsToBase64,
    applyLayerMask,
    setSelection,
    createAlphaChannel,
    getLayerForMatting,
    applyMattingResult
};
