/**
 * 导出图层为 Base64 / Raw 像素工具
 *
 * 三种模式：
 *  - imaging (默认)：使用 Photoshop UXP Imaging API 抓取像素并编码为 JPEG（仅 UXP 支持 JPEG 编码）。
 *                   适合快速抓取、缩略图、shape-morphing 等对画质要求不极致的场景。
 *  - native-png   ：通过 JSX 桥调用 Photoshop 原生 `doc.duplicate()` + `trim` + `saveAs PNG`，
 *                   然后把文件读回为 Base64。无损 PNG，画质上限 = Photoshop 渲染的上限。
 *                   适合需要 PS 端文件编码的场景；对原文档无破坏，但会短暂出现一个临时文档标签。
 *  - pixels-rgba  ：直接 `imaging.getPixels({ layerID })` 抓取目标图层的 raw RGBA 像素并返回
 *                   `Uint8Array`，**完全不创建任何临时文档、不动 visibility、PS 端零文档操作**，
 *                   实现真正的"零闪烁、无感"体验。调用方负责把 raw RGBA 通过二进制 ws 帧或
 *                   其它通道送给下游编码（推荐 Agent 端 sharp 编 PNG）。
 *
 * 说明：老版本会把 alpha 通道用 `|||` 拼到 base64 字符串后面，这会使 `data:image/...;base64,...`
 *       成为非法 Base64，导致下游（如火山方舟 Seedream）报 `Invalid base64 image_url`。
 *       新版本已移除该拼接，改用独立字段 `alphaChannel` 返回 alpha 数据。
 */

import { action, app, core, imaging } from 'photoshop';
import { storage } from 'uxp';
import { runJsxCode } from '../../core/jsx-bridge';
import { ToolResult } from '../types';

const fs = storage.localFileSystem;
const PHOTOSHOP_16BIT_MAX = 32768;

/**
 * Photoshop Imaging API 在超大画布上的安全上限（真机实测）。
 *
 * 长详情页 PSB（如 1440×28640）上，凡 `imaging.getPixels` 带 sourceBounds / layerID / applyAlpha
 * ——也就是"截取某个区域 / 某个图层"——都会失败（Photoshop 需要按全画布坐标系分配缓冲，超限）；
 * 只有"纯整画布 targetSize 降采样"能幸存。因此文档任一维度超过此阈值时，直接改走
 * exportUsingSmallDocPNG（把目标图层复制进一个临时小文档再截取），不再尝试注定失败的 imaging 单图层导出。
 * 阈值取 8000 与 getCanvasSnapshot 的"大文档"判定一致，留足安全裕度（正常主图/普通文档 < 8000 仍走快的 imaging）。
 */
const IMAGING_SAFE_MAX_DOC_DIMENSION = 8000;

/**
 * 从任意抛出物中稳健提取可读错误信息。
 *
 * Photoshop / UXP 抛出的往往不是标准 Error，而是 `{ number, message }` 之类的原生对象，
 * 甚至 `.message` 为 undefined。旧代码写 `error: error.message` 会让整个 error 字段在 JSON 序列化时
 * 被丢弃，上层只拿到 `{success:false, data:null}`——失败原因彻底消失（本次 bug 的直接成因）。
 * 这里逐级兜底：Error.message → 字符串 → 对象的 message/reason/description → JSON 序列化。
 */
function toErrorMessage(error: any): string {
    if (error instanceof Error && error.message) return error.message;
    if (typeof error === 'string' && error.trim()) return error.trim();
    if (error && typeof error === 'object') {
        const message = (error as any).message || (error as any).reason || (error as any).description;
        if (message) return String(message);
        try {
            const serialized = JSON.stringify(error);
            if (serialized && serialized !== '{}' && serialized !== 'null') return serialized;
        } catch {
            /* 序列化失败（如循环引用）时继续往下兜底 */
        }
    }
    return '';
}

/**
 * 将 Uint8Array 转换为 Base64（分块处理避免栈溢出）
 */
function uint8ArrayToBase64(data: Uint8Array): string {
    const CHUNK_SIZE = 32768;
    let binary = '';
    for (let i = 0; i < data.length; i += CHUNK_SIZE) {
        const chunk = data.subarray(i, Math.min(i + CHUNK_SIZE, data.length));
        binary += String.fromCharCode.apply(null, chunk as any);
    }
    return btoa(binary);
}

function normalizeTypedPixelData(
    data: Uint8Array | Uint16Array | Float32Array | ArrayBuffer,
    componentSize: number
): Uint8Array | Uint16Array | Float32Array {
    const buffer = data instanceof ArrayBuffer ? data : data.buffer;
    const byteOffset = data instanceof ArrayBuffer ? 0 : data.byteOffset;
    const byteLength = data instanceof ArrayBuffer ? data.byteLength : data.byteLength;
    if (componentSize === 16) {
        return data instanceof Uint16Array
            ? data
            : new Uint16Array(buffer, byteOffset, Math.floor(byteLength / 2));
    }
    if (componentSize === 32) {
        return data instanceof Float32Array
            ? data
            : new Float32Array(buffer, byteOffset, Math.floor(byteLength / 4));
    }
    return data instanceof Uint8Array
        ? data
        : new Uint8Array(buffer, byteOffset, byteLength);
}

function sampleTo8Bit(
    data: Uint8Array | Uint16Array | Float32Array,
    index: number,
    componentSize: number
): number {
    if (componentSize === 16) {
        const source = data as Uint16Array;
        const value = source[index] || 0;
        return Math.max(0, Math.min(255, Math.round((value / PHOTOSHOP_16BIT_MAX) * 255)));
    }
    if (componentSize === 32) {
        const source = data as Float32Array;
        const value = source[index] || 0;
        return Math.max(0, Math.min(255, Math.round(value * 255)));
    }
    const source = data as Uint8Array;
    return source[index] || 0;
}

function normalizePixelsToRgba8(
    data: Uint8Array | Uint16Array | Float32Array,
    pixelCount: number,
    components: number,
    componentSize: number
): Uint8ClampedArray {
    const output = new Uint8ClampedArray(pixelCount * 4);
    for (let i = 0; i < pixelCount; i++) {
        const src = i * components;
        const dst = i * 4;
        const red = sampleTo8Bit(data, src, componentSize);
        output[dst] = red;
        output[dst + 1] = components > 1 ? sampleTo8Bit(data, src + 1, componentSize) : red;
        output[dst + 2] = components > 2 ? sampleTo8Bit(data, src + 2, componentSize) : red;
        output[dst + 3] = components > 3 ? sampleTo8Bit(data, src + 3, componentSize) : 255;
    }
    return output;
}

function rgbaToRgb8(rgba: Uint8ClampedArray): Uint8Array {
    const rgb = new Uint8Array((rgba.length / 4) * 3);
    for (let i = 0; i < rgba.length / 4; i++) {
        const src = i * 4;
        const dst = i * 3;
        const alpha = (rgba[src + 3] ?? 255) / 255;
        rgb[dst] = Math.round((rgba[src] || 0) * alpha + 255 * (1 - alpha));
        rgb[dst + 1] = Math.round((rgba[src + 1] || 0) * alpha + 255 * (1 - alpha));
        rgb[dst + 2] = Math.round((rgba[src + 2] || 0) * alpha + 255 * (1 - alpha));
    }
    return rgb;
}

async function extractAlphaChannelFromImageData(
    imageData: any,
    width: number,
    height: number
): Promise<ExportLayerAlphaChannel | undefined> {
    const components = Number(imageData?.components) || 0;
    if (components < 4) return undefined;
    const componentSize = Number(imageData?.componentSize) || 8;
    const pixelCount = width * height;
    const rawData = await imageData.getData();
    const typedData = normalizeTypedPixelData(rawData, componentSize);
    const alphaData = new Uint8Array(pixelCount);
    for (let i = 0; i < pixelCount; i++) {
        alphaData[i] = sampleTo8Bit(typedData, i * components + 3, componentSize);
    }
    return {
        base64: uint8ArrayToBase64(alphaData),
        width,
        height
    };
}

async function encodeRawImageDataToBase64(imageData: any): Promise<string> {
    const encodedData = await imaging.encodeImageData({
        imageData,
        base64: true
    });
    if (typeof encodedData === 'string') return encodedData;
    if (Array.isArray(encodedData)) return uint8ArrayToBase64(new Uint8Array(encodedData));
    if (encodedData && typeof encodedData === 'object' && typeof (encodedData as any).base64 === 'string') {
        return (encodedData as any).base64;
    }
    throw new Error('imaging.encodeImageData returned no base64 payload');
}

async function encodeRgb8ToBase64(rgb: Uint8Array, width: number, height: number): Promise<string> {
    const imageDataObj = await imaging.createImageDataFromBuffer(rgb, {
        width,
        height,
        components: 3,
        colorSpace: 'RGB',
        colorProfile: 'sRGB IEC61966-2.1'
    });
    try {
        return await encodeRawImageDataToBase64(imageDataObj);
    } finally {
        imageDataObj.dispose();
    }
}

async function encodeImageDataToBase64(imageData: any, width: number, height: number): Promise<string> {
    const componentSize = Number(imageData?.componentSize) || 8;
    if (componentSize === 8) {
        try {
            return await encodeRawImageDataToBase64(imageData);
        } catch (error: any) {
            console.warn('[ExportLayer] 8bit 直接编码失败，改用 RGB 归一化编码:', error?.message || error);
        }
    }

    const components = Number(imageData?.components) || 4;
    const pixelCount = width * height;
    const rawData = await imageData.getData();
    const typedData = normalizeTypedPixelData(rawData, componentSize);
    const rgba = normalizePixelsToRgba8(typedData, pixelCount, components, componentSize);
    const rgb = rgbaToRgb8(rgba);
    return await encodeRgb8ToBase64(rgb, width, height);
}

function disposeImageDataContainer(container: any): void {
    const imageData = container?.imageData;
    if (imageData && typeof imageData.dispose === 'function') {
        imageData.dispose();
    }
}

export type ExportLayerMode = 'imaging' | 'native-png' | 'pixels-rgba';

export interface ExportLayerParams {
    layerId: number;
    /**
     * imaging: JPEG（快、适合 shape-morphing 等场景）
     * native-png: 通过 Photoshop 原生 saveAs 导出 PNG（无损，画质满血但临时文档会闪一下标签）
     * pixels-rgba: 直接抓 RGBA 像素，零文档操作（最优用户体验，需调用方自己处理传输/编码）
     */
    mode?: ExportLayerMode;
    /**
     * 仅在 imaging 模式下使用。native-png 模式下 format 固定为 'png'。pixels-rgba 模式忽略。
     */
    format?: 'png' | 'jpeg';
    /** 保留参数，当前 imaging 路径仅用 JPEG 编码，未显式设置 quality */
    quality?: number;
    /** 最大边长（像素），超过会按比例缩放 */
    maxSize?: number;
}

export interface ExportLayerAlphaChannel {
    base64: string;
    width: number;
    height: number;
}

export interface ExportLayerResult {
    success: boolean;
    /** 图像主数据的 Base64（不含 data URL 前缀），保证为合法 Base64 字符串。pixels-rgba 模式下为空。 */
    base64: string;
    /**
     * 实际 Base64 的 MIME 类型：
     *   - native-png：image/png
     *   - imaging：image/jpeg
     *   - pixels-rgba：image/x-raw-rgba（约定值，标识返回的是 raw 像素，不是已编码图像）
     */
    mimeType: 'image/png' | 'image/jpeg' | 'image/x-raw-rgba';
    /** 实际数据的输出尺寸（可能已按 maxSize 缩放） */
    width: number;
    height: number;
    /** 兼容字段（与 mimeType 同步） */
    format: string;
    /** 原图层在文档坐标系下的 bounds */
    contentBounds?: {
        left: number;
        top: number;
        right: number;
        bottom: number;
        width: number;
        height: number;
    };
    /** 仅 imaging 模式可能返回（原先用 `|||ALPHA:` 拼在 base64 后面，现独立成字段） */
    alphaChannel?: ExportLayerAlphaChannel;
    /**
     * 仅 pixels-rgba 模式：raw RGBA 像素 buffer（每像素 4 字节，行优先，从左上到右下）。
     * 不在此处做 base64 编码以避免 v8 处理超大字符串的内存峰值；调用方应通过二进制 ws 帧传输。
     */
    rawPixels?: Uint8Array;
    /** 仅 pixels-rgba 模式：通道数（通常 = 4 = RGBA） */
    components?: number;
    /** 仅 pixels-rgba 模式：每通道位深（通常 = 8） */
    componentSize?: number;
}

/**
 * 对外暴露的统一入口
 */
export async function exportLayerAsBase64(params: ExportLayerParams): Promise<ToolResult<ExportLayerResult>> {
    const requestedMode = params.mode;
    const mode: ExportLayerMode = requestedMode === 'native-png' || requestedMode === 'pixels-rgba'
        ? requestedMode
        : 'imaging';
    console.log(`[ExportLayer] 开始导出图层，mode=${mode}...`);
    const startTime = performance.now();

    try {
        const { layerId, format = 'png', quality = 80, maxSize = 2048 } = params;

        const doc = app.activeDocument;
        if (!doc) {
            return {
                success: false,
                error: '没有打开的文档',
                data: null
            };
        }

        const layer = findLayerById(doc, layerId);
        if (!layer) {
            return {
                success: false,
                error: `未找到图层 ID: ${layerId}`,
                data: null
            };
        }

        console.log(`[ExportLayer] 图层: ${layer.name} (ID: ${layerId})`);

        const bounds = layer.boundsNoEffects || layer.bounds;
        const layerWidth = bounds.right - bounds.left;
        const layerHeight = bounds.bottom - bounds.top;

        console.log(`[ExportLayer] 图层尺寸: ${layerWidth}x${layerHeight}`);

        if (mode === 'native-png') {
            const nativeResult = await exportUsingNativePNG(layerId, maxSize);
            const processingTime = performance.now() - startTime;
            console.log(
                `[ExportLayer] ✅ native-png 完成, ${Math.round(nativeResult.base64.length / 1024)}KB, ` +
                `${nativeResult.width}x${nativeResult.height}, 耗时 ${processingTime.toFixed(0)}ms`
            );

            return {
                success: true,
                data: {
                    success: true,
                    base64: nativeResult.base64,
                    mimeType: 'image/png',
                    width: nativeResult.width,
                    height: nativeResult.height,
                    format: 'png',
                    contentBounds: nativeResult.contentBounds || {
                        left: bounds.left,
                        top: bounds.top,
                        right: bounds.right,
                        bottom: bounds.bottom,
                        width: layerWidth,
                        height: layerHeight
                    }
                }
            };
        }

        if (mode === 'pixels-rgba') {
            const rawResult = await exportUsingPixelsRGBA(doc.id, layerId, layer, maxSize);
            const processingTime = performance.now() - startTime;
            console.log(
                `[ExportLayer] ✅ pixels-rgba 完成（零文档操作）, ` +
                `${Math.round(rawResult.rawPixels.length / 1024)}KB raw, ` +
                `${rawResult.width}x${rawResult.height}, 耗时 ${processingTime.toFixed(0)}ms`
            );

            return {
                success: true,
                data: {
                    success: true,
                    base64: '',
                    mimeType: 'image/x-raw-rgba',
                    width: rawResult.width,
                    height: rawResult.height,
                    format: 'raw-rgba',
                    rawPixels: rawResult.rawPixels,
                    components: rawResult.components,
                    componentSize: rawResult.componentSize,
                    contentBounds: {
                        left: bounds.left,
                        top: bounds.top,
                        right: bounds.right,
                        bottom: bounds.bottom,
                        width: layerWidth,
                        height: layerHeight
                    }
                }
            };
        }

        // 超大画布上 imaging 的单图层/区域导出必现失败（见 IMAGING_SAFE_MAX_DOC_DIMENSION 注释）。
        // 对这类文档直接走"临时小文档 PNG"路径，不浪费一次注定失败的 imaging 尝试；
        // 其余正常文档仍走快的 imaging，失败时再回退，且全程保留可读错误。
        const docIsOversizedForImaging =
            doc.width > IMAGING_SAFE_MAX_DOC_DIMENSION || doc.height > IMAGING_SAFE_MAX_DOC_DIMENSION;

        let imagingOutput: ImagingExportOutput | null = null;
        let imagingFailureDetail = '';
        if (docIsOversizedForImaging) {
            console.log(
                `[ExportLayer] 文档 ${doc.width}x${doc.height} 超过 imaging 安全阈值 ${IMAGING_SAFE_MAX_DOC_DIMENSION}，` +
                `跳过 imaging 单图层导出，直接走临时小文档 PNG`
            );
        } else {
            try {
                imagingOutput = await exportUsingImagingAPI(doc.id, layer, format, quality, maxSize);
            } catch (imagingError) {
                imagingFailureDetail = toErrorMessage(imagingError);
                console.warn('[ExportLayer] Imaging API 失败，尝试 batchPlay 方式:', imagingFailureDetail || imagingError);
                try {
                    imagingOutput = await exportUsingBatchPlay(doc, layer, format);
                } catch (batchPlayError) {
                    const batchPlayDetail = toErrorMessage(batchPlayError);
                    imagingFailureDetail = [imagingFailureDetail, batchPlayDetail ? `batchPlay: ${batchPlayDetail}` : '']
                        .filter(Boolean)
                        .join('; ');
                    console.warn('[ExportLayer] batchPlay 也失败，回退临时小文档 PNG:', imagingFailureDetail || batchPlayError);
                }
            }
        }

        if (imagingOutput && imagingOutput.base64) {
            let outputWidth = layerWidth;
            let outputHeight = layerHeight;
            if (layerWidth > maxSize || layerHeight > maxSize) {
                const scale = Math.min(maxSize / layerWidth, maxSize / layerHeight);
                outputWidth = Math.round(layerWidth * scale);
                outputHeight = Math.round(layerHeight * scale);
            }

            const processingTime = performance.now() - startTime;
            console.log(
                `[ExportLayer] ✅ imaging 完成, ${Math.round(imagingOutput.base64.length / 1024)}KB, 耗时 ${processingTime.toFixed(0)}ms`
            );

            return {
                success: true,
                data: {
                    success: true,
                    base64: imagingOutput.base64,
                    mimeType: 'image/jpeg',
                    width: outputWidth,
                    height: outputHeight,
                    format: 'jpeg',
                    contentBounds: {
                        left: bounds.left,
                        top: bounds.top,
                        right: bounds.right,
                        bottom: bounds.bottom,
                        width: layerWidth,
                        height: layerHeight
                    },
                    ...(imagingOutput.alphaChannel ? { alphaChannel: imagingOutput.alphaChannel } : {})
                }
            };
        }

        // 兜底路径：超大文档 或 imaging+batchPlay 均失败 → 复制图层到临时小文档再导出 PNG（绕开 imaging 画布限制）
        try {
            const smallDoc = await exportUsingSmallDocPNG(doc.id, layerId, maxSize);
            const processingTime = performance.now() - startTime;
            console.log(
                `[ExportLayer] ✅ small-doc-png 完成, ${Math.round(smallDoc.base64.length / 1024)}KB, ` +
                `${smallDoc.width}x${smallDoc.height}, 耗时 ${processingTime.toFixed(0)}ms` +
                `${docIsOversizedForImaging ? '（超大文档专用路径）' : '（imaging 失败回退）'}`
            );
            return {
                success: true,
                data: {
                    success: true,
                    base64: smallDoc.base64,
                    mimeType: 'image/png',
                    width: smallDoc.width,
                    height: smallDoc.height,
                    format: 'png',
                    contentBounds: smallDoc.contentBounds || {
                        left: bounds.left,
                        top: bounds.top,
                        right: bounds.right,
                        bottom: bounds.bottom,
                        width: layerWidth,
                        height: layerHeight
                    }
                }
            };
        } catch (fallbackError) {
            const fallbackDetail = toErrorMessage(fallbackError) || '未提供错误详情';
            const reason = docIsOversizedForImaging
                ? `导出图层「${layer.name}」失败：文档尺寸 ${doc.width}x${doc.height}px 触发 Photoshop imaging 限制，` +
                  `改用临时小文档导出也失败：${fallbackDetail}`
                : `导出图层「${layer.name}」失败：imaging 导出失败（${imagingFailureDetail || '无详情'}），` +
                  `回退临时小文档导出也失败：${fallbackDetail}`;
            console.error('[ExportLayer] 全部导出路径失败:', reason);
            return {
                success: false,
                error: reason,
                data: null
            };
        }
    } catch (error: any) {
        const detail = toErrorMessage(error);
        console.error('[ExportLayer] 失败:', error);
        return {
            success: false,
            error: detail || '导出图层像素时发生未知错误（Photoshop 未提供错误详情）',
            data: null
        };
    }
}

interface ImagingExportOutput {
    base64: string;
    alphaChannel?: ExportLayerAlphaChannel;
}

/**
 * 使用 Imaging API 导出（JPEG）
 *
 * 策略：临时隐藏其他图层，使用 documentID 获取合成像素，然后恢复图层可见性。
 */
async function exportUsingImagingAPI(
    docId: number,
    layer: any,
    _format: string,
    _quality: number,
    maxSize: number
): Promise<ImagingExportOutput> {
    let output: ImagingExportOutput = { base64: '' };

    await core.executeAsModal(async () => {
        const doc = app.activeDocument!;

        const bounds = layer.boundsNoEffects || layer.bounds;
        const layerWidth = bounds.right - bounds.left;
        const layerHeight = bounds.bottom - bounds.top;

        let targetWidth = layerWidth;
        let targetHeight = layerHeight;

        if (layerWidth > maxSize || layerHeight > maxSize) {
            const scale = Math.min(maxSize / layerWidth, maxSize / layerHeight);
            targetWidth = Math.round(layerWidth * scale);
            targetHeight = Math.round(layerHeight * scale);
        }

        const layerVisibility: Map<number, boolean> = new Map();

        function collectAllLayers(container: any): any[] {
            const result: any[] = [];
            for (const l of container.layers) {
                result.push(l);
                if (l.layers) {
                    result.push(...collectAllLayers(l));
                }
            }
            return result;
        }

        const allLayers = collectAllLayers(doc);

        const hiddenLayers: string[] = [];
        for (const l of allLayers) {
            layerVisibility.set(l.id, l.visible);
            if (l.id !== layer.id) {
                if (l.visible) {
                    hiddenLayers.push(l.name);
                }
                l.visible = false;
            } else {
                l.visible = true;
            }
        }
        console.log(`[ExportLayer] 单图层导出: 只保留 "${layer.name}" 可见，临时隐藏 ${hiddenLayers.length} 层`);

        let pixelData: any;
        let rgbPixelData: any;
        try {
            pixelData = await imaging.getPixels({
                documentID: docId,
                sourceBounds: {
                    left: bounds.left,
                    top: bounds.top,
                    right: bounds.right,
                    bottom: bounds.bottom
                },
                targetSize: {
                    width: targetWidth,
                    height: targetHeight
                },
                applyAlpha: false
            });

            const rawData = pixelData.imageData;
            const alpha = await extractAlphaChannelFromImageData(rawData, targetWidth, targetHeight);

            rgbPixelData = await imaging.getPixels({
                documentID: docId,
                sourceBounds: {
                    left: bounds.left,
                    top: bounds.top,
                    right: bounds.right,
                    bottom: bounds.bottom
                },
                targetSize: {
                    width: targetWidth,
                    height: targetHeight
                },
                applyAlpha: true
            });

            const imageBase64 = await encodeImageDataToBase64(rgbPixelData.imageData, targetWidth, targetHeight);
            output = alpha ? { base64: imageBase64, alphaChannel: alpha } : { base64: imageBase64 };
        } finally {
            disposeImageDataContainer(pixelData);
            disposeImageDataContainer(rgbPixelData);
            for (const l of allLayers) {
                const originalVisible = layerVisibility.get(l.id);
                if (originalVisible !== undefined) {
                    l.visible = originalVisible;
                }
            }
        }
    }, { commandName: '导出图层为Base64' });

    return output;
}

/**
 * 使用备用 batchPlay 方式导出（Imaging API 失败时的退路）
 */
async function exportUsingBatchPlay(_doc: any, layer: any, _format: string): Promise<ImagingExportOutput> {
    let output: ImagingExportOutput = { base64: '' };

    await core.executeAsModal(async () => {
        const doc = app.activeDocument!;
        const bounds = layer.bounds;
        const layerWidth = bounds.right - bounds.left;
        const layerHeight = bounds.bottom - bounds.top;

        const layerVisibility: Map<number, boolean> = new Map();

        function collectAllLayers(container: any): any[] {
            const result: any[] = [];
            for (const l of container.layers) {
                result.push(l);
                if (l.layers) {
                    result.push(...collectAllLayers(l));
                }
            }
            return result;
        }

        const allLayers = collectAllLayers(doc);

        for (const l of allLayers) {
            layerVisibility.set(l.id, l.visible);
            l.visible = l.id === layer.id;
        }

        let pixelDataRaw: any;
        let pixelData: any;
        try {
            const targetWidth = Math.min(layerWidth, 2048);
            const targetHeight = Math.min(layerHeight, 2048);

            pixelDataRaw = await imaging.getPixels({
                documentID: doc.id,
                sourceBounds: {
                    left: bounds.left,
                    top: bounds.top,
                    right: bounds.right,
                    bottom: bounds.bottom
                },
                targetSize: {
                    width: targetWidth,
                    height: targetHeight
                },
                applyAlpha: false
            });

            const rawData = pixelDataRaw.imageData;
            const alpha = await extractAlphaChannelFromImageData(rawData, targetWidth, targetHeight);

            pixelData = await imaging.getPixels({
                documentID: doc.id,
                sourceBounds: {
                    left: bounds.left,
                    top: bounds.top,
                    right: bounds.right,
                    bottom: bounds.bottom
                },
                targetSize: {
                    width: targetWidth,
                    height: targetHeight
                },
                applyAlpha: true
            });

            const imageBase64 = await encodeImageDataToBase64(pixelData.imageData, targetWidth, targetHeight);
            output = alpha ? { base64: imageBase64, alphaChannel: alpha } : { base64: imageBase64 };
        } finally {
            disposeImageDataContainer(pixelDataRaw);
            disposeImageDataContainer(pixelData);
            for (const l of allLayers) {
                const originalVisible = layerVisibility.get(l.id);
                if (originalVisible !== undefined) {
                    l.visible = originalVisible;
                }
            }
        }
    }, { commandName: '导出图层为Base64' });

    return output;
}

interface NativePNGExportResult {
    base64: string;
    width: number;
    height: number;
    contentBounds?: {
        left: number;
        top: number;
        right: number;
        bottom: number;
        width: number;
        height: number;
    };
}

/**
 * native-png 模式：通过 JSX 桥调用 Photoshop 原生 saveAs 导出无损 PNG
 *
 * 「零闪烁」流程（v2）：
 *   1. **完全不修改原文档的图层可见性**（这是 v1 黑屏闪烁的根因）
 *   2. `sourceDoc.duplicate(tempName, false)` 全量复制图层结构 → 临时文档与原文档画面一致
 *      PS 会自动把临时文档设为 activeDocument，此时用户看到的"切换"是无缝的
 *   3. 在临时文档上递归删除所有非目标图层（含空组），破坏只发生在临时文档
 *   4. 在临时文档上 `trim(TrimType.TRANSPARENT)` → 紧贴目标图层
 *   5. 如尺寸超 maxSize 用 `resizeImage` 等比缩放
 *   6. `saveAs` 为 PNG（PNGSaveOptions, compression=6, interlaced=false）到临时文件
 *   7. 关闭临时文档（DONOTSAVECHANGES，原文档自动重新激活）
 *   8. UXP 侧把 PNG 文件读回 Base64，删除临时文件
 *
 * 用户观感：原文档画面全程不变；标签栏短暂出现一个临时标签做事；不再有黑屏。
 */
async function exportUsingNativePNG(layerId: number, maxSize: number): Promise<NativePNGExportResult> {
    const tempFolder = await fs.getTemporaryFolder();
    const tempFileName = `designecho_i2i_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.png`;
    const tempFile = await tempFolder.createFile(tempFileName, { overwrite: true });
    const tempFilePath: string = (tempFile as any).nativePath;
    if (!tempFilePath) {
        throw new Error('无法获取临时文件 nativePath');
    }

    const escapedPath = tempFilePath.replace(/\\/g, '/').replace(/'/g, "\\'");
    const normalizedMaxSize = Math.max(0, Math.floor(Number(maxSize) || 0));

    const jsx = `
var __dePrevDialogs = app.displayDialogs;
app.displayDialogs = DialogModes.NO;
var __deOutput = '';
function __deEncode(value) {
    return encodeURIComponent(String(value === undefined || value === null ? '' : value));
}
function __deResult(fields) {
    var parts = [];
    for (var key in fields) {
        if (!fields.hasOwnProperty(key)) continue;
        if (fields[key] === undefined || fields[key] === null) continue;
        parts.push(__deEncode(key) + '=' + __deEncode(fields[key]));
    }
    __deOutput = '__DESIGNECHO_RESULT__' + parts.join('&');
    return __deOutput;
}

var sourceDoc = null;
var tempDoc = null;
try {
    if (!app.documents.length) throw new Error('No active document');
    sourceDoc = app.activeDocument;

    var LAYER_ID = ${Number(layerId) || 0};
    var MAX_SIZE = ${normalizedMaxSize};

    function findLayerById(container, id) {
        if (!container || !container.layers) return null;
        for (var i = 0; i < container.layers.length; i++) {
            var l = container.layers[i];
            if (l.id === id) return l;
            if (l.layers && l.layers.length > 0) {
                var found = findLayerById(l, id);
                if (found) return found;
            }
        }
        return null;
    }

    function asPixels(unitValue) {
        try { return Number(unitValue.as('px')); }
        catch (e) { return Number(unitValue); }
    }

    var srcTargetLayer = findLayerById(sourceDoc, LAYER_ID);
    if (!srcTargetLayer) throw new Error('Target layer not found: ' + LAYER_ID);

    // 在删除前用源文档读取 bounds（保证使用原始坐标，不被 tempDoc 后续 trim/resize 影响）
    var contentLeft = 0, contentTop = 0, contentRight = 0, contentBottom = 0;
    try {
        contentLeft = Math.round(asPixels(srcTargetLayer.bounds[0]));
        contentTop = Math.round(asPixels(srcTargetLayer.bounds[1]));
        contentRight = Math.round(asPixels(srcTargetLayer.bounds[2]));
        contentBottom = Math.round(asPixels(srcTargetLayer.bounds[3]));
    } catch (boundsError) {}

    // 1. 全量 duplicate（保留所有图层结构 + 当前可见性）
    //    PS 会把 tempDoc 自动设为 activeDocument；视觉上和原文档一致，无闪烁
    var tempName = 'designecho_i2i_' + (new Date().getTime());
    tempDoc = sourceDoc.duplicate(tempName, false);
    app.activeDocument = tempDoc;

    // 2. 在 tempDoc 上递归删除所有非目标图层（自底向上 + 同步删空组）
    //    所有破坏操作只影响 tempDoc，原文档 sourceDoc 完全不动
    function pruneNonTarget(container, keepId) {
        if (!container || !container.layers) return false;
        var hasTargetInside = false;
        for (var i = container.layers.length - 1; i >= 0; i--) {
            var l = container.layers[i];
            if (l.id === keepId) {
                hasTargetInside = true;
                continue;
            }
            if (l.layers && l.layers.length > 0) {
                var subHasTarget = pruneNonTarget(l, keepId);
                if (subHasTarget) {
                    hasTargetInside = true;
                } else {
                    try { l.remove(); } catch (rmGroupError) {}
                }
            } else {
                try { l.remove(); } catch (rmLeafError) {}
            }
        }
        return hasTargetInside;
    }
    var foundInTemp = pruneNonTarget(tempDoc, LAYER_ID);
    if (!foundInTemp) {
        throw new Error('Target layer disappeared after duplication: ' + LAYER_ID);
    }

    // 3. trim 透明边界
    try {
        tempDoc.trim(TrimType.TRANSPARENT, true, true, true, true);
    } catch (trimError) {}

    var w = Math.max(1, Math.round(asPixels(tempDoc.width) || 1));
    var h = Math.max(1, Math.round(asPixels(tempDoc.height) || 1));
    if (MAX_SIZE > 0) {
        var longest = Math.max(w, h);
        if (longest > MAX_SIZE) {
            var scale = MAX_SIZE / longest;
            var tw = Math.max(1, Math.round(w * scale));
            var th = Math.max(1, Math.round(h * scale));
            tempDoc.resizeImage(
                UnitValue(tw, 'px'),
                UnitValue(th, 'px'),
                undefined,
                ResampleMethod.BICUBICSHARPER
            );
            w = tw;
            h = th;
        }
    }

    var target = new File('${escapedPath}');
    if (!target.parent.exists) target.parent.create();
    var pngOptions = new PNGSaveOptions();
    pngOptions.compression = 6;
    pngOptions.interlaced = false;
    tempDoc.saveAs(target, pngOptions, true, Extension.LOWERCASE);

    __deResult({
        success: 1,
        path: target.fsName,
        width: w,
        height: h,
        contentLeft: contentLeft,
        contentTop: contentTop,
        contentRight: contentRight,
        contentBottom: contentBottom
    });
} catch (error) {
    __deResult({
        success: 0,
        error: String(error && error.message ? error.message : error)
    });
} finally {
    try {
        if (tempDoc && sourceDoc && tempDoc !== sourceDoc) {
            tempDoc.close(SaveOptions.DONOTSAVECHANGES);
        }
    } catch (cleanupError) {}
    try {
        if (sourceDoc) app.activeDocument = sourceDoc;
    } catch (activeRestoreError) {}
    try {
        app.displayDialogs = __dePrevDialogs;
    } catch (dialogsError) {}
}
__deOutput;
`;

    let jsxData: any;
    try {
        const result = await runJsxCode(jsx, 'Export Layer as Native PNG');
        jsxData = result.data;
        if (!jsxData?.success) {
            const message = jsxData?.error || result.message || 'Native PNG export failed (JSX)';
            throw new Error(message);
        }
    } catch (jsxError) {
        try { await tempFile.delete(); } catch { /* noop */ }
        throw jsxError;
    }

    let base64 = '';
    try {
        const arrayBuffer = await tempFile.read({ format: storage.formats.binary });
        const bytes = new Uint8Array(arrayBuffer as ArrayBuffer);
        base64 = uint8ArrayToBase64(bytes);
    } finally {
        try { await tempFile.delete(); } catch { /* noop */ }
    }

    if (!base64) {
        throw new Error('Native PNG export produced empty file');
    }

    const width = Number(jsxData.width) || 0;
    const height = Number(jsxData.height) || 0;
    const contentLeft = Number(jsxData.contentLeft) || 0;
    const contentTop = Number(jsxData.contentTop) || 0;
    const contentRight = Number(jsxData.contentRight) || 0;
    const contentBottom = Number(jsxData.contentBottom) || 0;

    return {
        base64,
        width,
        height,
        contentBounds: {
            left: contentLeft,
            top: contentTop,
            right: contentRight,
            bottom: contentBottom,
            width: Math.max(0, contentRight - contentLeft),
            height: Math.max(0, contentBottom - contentTop)
        }
    };
}

/**
 * 超大文档专用 / imaging 兜底：把单个目标图层复制进一个"贴合图层尺寸的临时小文档"，再从该小文档导出 PNG。
 *
 * 为什么不用 native-png（exportUsingNativePNG）？
 *   native-png 先 `sourceDoc.duplicate()` 复制整份文档（在 1440×28640 的详情页上会因内存/耗时触发 PS 弹窗超时），
 *   再逐层删除。而这里 `documents.add` 直接建一个只有图层大小的小画布，`srcLayer.duplicate(newDoc)` 只搬目标图层，
 *   全程不复制巨幅画布——快、稳，且对普通像素层 / 智能对象 / 图层组都适用。
 *
 * 关键点：图层复制到新文档后仍保留原文档坐标（可能为负、超出小画布），需要 translate 到 (0,0) 才不丢内容。
 */
async function exportUsingSmallDocPNG(
    sourceDocId: number,
    layerId: number,
    maxSize: number
): Promise<NativePNGExportResult> {
    const tempFolder = await fs.getTemporaryFolder();
    const tempFileName = `designecho_layer_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.png`;
    const tempFile = await tempFolder.createFile(tempFileName, { overwrite: true });
    const tempFilePath: string = (tempFile as any).nativePath;
    if (!tempFilePath) {
        throw new Error('无法获取临时文件 nativePath');
    }

    const escapedPath = tempFilePath.replace(/\\/g, '/').replace(/'/g, "\\'");
    const normalizedMaxSize = Math.max(0, Math.floor(Number(maxSize) || 0));

    const jsx = `
var __dePrevDialogs = app.displayDialogs;
app.displayDialogs = DialogModes.NO;
var __deOutput = '';
function __deEncode(value) {
    return encodeURIComponent(String(value === undefined || value === null ? '' : value));
}
function __deResult(fields) {
    var parts = [];
    for (var key in fields) {
        if (!fields.hasOwnProperty(key)) continue;
        if (fields[key] === undefined || fields[key] === null) continue;
        parts.push(__deEncode(key) + '=' + __deEncode(fields[key]));
    }
    __deOutput = '__DESIGNECHO_RESULT__' + parts.join('&');
    return __deOutput;
}

var sourceDoc = null;
var newDoc = null;
var prevActive = null;
try {
    if (!app.documents.length) throw new Error('No open documents');
    prevActive = app.activeDocument;

    var SOURCE_DOC_ID = ${Number(sourceDocId) || 0};
    var LAYER_ID = ${Number(layerId) || 0};
    var MAX_SIZE = ${normalizedMaxSize};

    for (var di = 0; di < app.documents.length; di++) {
        if (app.documents[di].id === SOURCE_DOC_ID) { sourceDoc = app.documents[di]; break; }
    }
    if (!sourceDoc) sourceDoc = prevActive;
    if (!sourceDoc) throw new Error('Source document not found: ' + SOURCE_DOC_ID);

    function findLayerById(container, id) {
        if (!container || !container.layers) return null;
        for (var i = 0; i < container.layers.length; i++) {
            var l = container.layers[i];
            if (l.id === id) return l;
            if (l.layers && l.layers.length > 0) {
                var found = findLayerById(l, id);
                if (found) return found;
            }
        }
        return null;
    }
    function asPixels(unitValue) {
        try { return Number(unitValue.as('px')); }
        catch (e) { return Number(unitValue); }
    }

    app.activeDocument = sourceDoc;
    var srcLayer = findLayerById(sourceDoc, LAYER_ID);
    if (!srcLayer) throw new Error('Target layer not found in document ' + sourceDoc.id + ': ' + LAYER_ID);

    var sb = srcLayer.bounds;
    var contentLeft = Math.round(asPixels(sb[0]));
    var contentTop = Math.round(asPixels(sb[1]));
    var contentRight = Math.round(asPixels(sb[2]));
    var contentBottom = Math.round(asPixels(sb[3]));
    var w = Math.max(1, contentRight - contentLeft);
    var h = Math.max(1, contentBottom - contentTop);

    // 1. 建一个贴合图层尺寸的透明小文档（不复制巨幅画布）
    var res = 72;
    try { res = sourceDoc.resolution; } catch (resErr) {}
    var tempName = 'designecho_layer_' + (new Date().getTime());
    newDoc = app.documents.add(
        UnitValue(w, 'px'),
        UnitValue(h, 'px'),
        res,
        tempName,
        NewDocumentMode.RGB,
        DocumentFill.TRANSPARENT
    );

    // 2. 只把目标图层复制进小文档（智能对象/组/像素层通用）
    app.activeDocument = sourceDoc;
    var dup = srcLayer.duplicate(newDoc, ElementPlacement.PLACEATBEGINNING);
    app.activeDocument = newDoc;

    // 3. 图层复制后仍是原文档坐标（可能为负/超界），平移到 (0,0) 才不丢内容
    try {
        var nb = dup.bounds;
        var nL = asPixels(nb[0]);
        var nT = asPixels(nb[1]);
        if (nL !== 0 || nT !== 0) {
            dup.translate(UnitValue(-nL, 'px'), UnitValue(-nT, 'px'));
        }
    } catch (translateErr) {}

    // 4. 移除新文档自带的空透明背景层，只留目标图层
    try {
        for (var li = newDoc.layers.length - 1; li >= 0; li--) {
            if (newDoc.layers[li].id !== dup.id) {
                try { newDoc.layers[li].remove(); } catch (rmErr) {}
            }
        }
    } catch (cleanErr) {}

    // 5. trim 透明边界，贴紧内容
    try { newDoc.trim(TrimType.TRANSPARENT, true, true, true, true); } catch (trimErr) {}

    var ow = Math.max(1, Math.round(asPixels(newDoc.width) || 1));
    var oh = Math.max(1, Math.round(asPixels(newDoc.height) || 1));
    if (MAX_SIZE > 0) {
        var longest = Math.max(ow, oh);
        if (longest > MAX_SIZE) {
            var scale = MAX_SIZE / longest;
            var tw = Math.max(1, Math.round(ow * scale));
            var th = Math.max(1, Math.round(oh * scale));
            newDoc.resizeImage(UnitValue(tw, 'px'), UnitValue(th, 'px'), undefined, ResampleMethod.BICUBICSHARPER);
            ow = tw;
            oh = th;
        }
    }

    var target = new File('${escapedPath}');
    if (!target.parent.exists) target.parent.create();
    var pngOptions = new PNGSaveOptions();
    pngOptions.compression = 6;
    pngOptions.interlaced = false;
    newDoc.saveAs(target, pngOptions, true, Extension.LOWERCASE);

    __deResult({
        success: 1,
        path: target.fsName,
        width: ow,
        height: oh,
        contentLeft: contentLeft,
        contentTop: contentTop,
        contentRight: contentRight,
        contentBottom: contentBottom
    });
} catch (error) {
    __deResult({
        success: 0,
        error: String(error && error.message ? error.message : error)
    });
} finally {
    try {
        if (newDoc) { newDoc.close(SaveOptions.DONOTSAVECHANGES); }
    } catch (cleanupError) {}
    try {
        if (prevActive) { app.activeDocument = prevActive; }
    } catch (activeRestoreError) {}
    try {
        app.displayDialogs = __dePrevDialogs;
    } catch (dialogsError) {}
}
__deOutput;
`;

    let jsxData: any;
    try {
        const result = await runJsxCode(jsx, 'Export Single Layer via Small Temp Document');
        jsxData = result.data;
        if (!jsxData?.success) {
            const message = jsxData?.error || result.message || 'Small-doc PNG export failed (JSX)';
            throw new Error(message);
        }
    } catch (jsxError) {
        try { await tempFile.delete(); } catch { /* noop */ }
        throw jsxError;
    }

    let base64 = '';
    try {
        const arrayBuffer = await tempFile.read({ format: storage.formats.binary });
        const bytes = new Uint8Array(arrayBuffer as ArrayBuffer);
        base64 = uint8ArrayToBase64(bytes);
    } finally {
        try { await tempFile.delete(); } catch { /* noop */ }
    }

    if (!base64) {
        throw new Error('Small-doc PNG export produced empty file');
    }

    const width = Number(jsxData.width) || 0;
    const height = Number(jsxData.height) || 0;
    const contentLeft = Number(jsxData.contentLeft) || 0;
    const contentTop = Number(jsxData.contentTop) || 0;
    const contentRight = Number(jsxData.contentRight) || 0;
    const contentBottom = Number(jsxData.contentBottom) || 0;

    return {
        base64,
        width,
        height,
        contentBounds: {
            left: contentLeft,
            top: contentTop,
            right: contentRight,
            bottom: contentBottom,
            width: Math.max(0, contentRight - contentLeft),
            height: Math.max(0, contentBottom - contentTop)
        }
    };
}

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

interface PixelsRGBAExportResult {
    rawPixels: Uint8Array;
    width: number;
    height: number;
    components: number;
    componentSize: number;
}

/**
 * pixels-rgba 模式：用 imaging.getPixels({ documentID, layerID }) 直接抓单图层 RGBA。
 *
 * 关键：传入 `layerID` 让 PS 内部只 composite 这一个图层，**完全不需要修改 visibility，
 * 不需要 duplicate 文档，不创建临时文档**。整个调用对原文档零破坏、零视觉影响，
 * 实现真正的"零闪烁、无感"体验。
 *
 * 同模式生产实战参考：remove-background.ts / apply-displacement.ts / get-subject-bounds.ts
 *
 * 输出 RGBA 通道（components=4），由调用方负责把 raw 字节通过二进制 ws 帧发给 Agent，
 * Agent 端用 sharp.raw({ width, height, channels: 4 }).png() 编码无损 PNG。
 */
async function exportUsingPixelsRGBA(
    docId: number,
    layerId: number,
    layer: any,
    maxSize: number
): Promise<PixelsRGBAExportResult> {
    let outResult: PixelsRGBAExportResult | null = null;

    const kind = String(layer?.kind || '').toLowerCase();
    const isBackground = !!layer?.isBackgroundLayer || kind === 'background';
    const layerName = String(layer?.name || '');
    console.log(
        `[pixels-rgba] Begin capture: id=${layerId}, name=${layerName}, kind=${kind}, ` +
        `isBackground=${isBackground}, maxSize=${maxSize}`
    );

    await core.executeAsModal(async () => {
        const bounds = layer.boundsNoEffects || layer.bounds;
        const layerW = Math.max(1, Math.round(bounds.right - bounds.left));
        const layerH = Math.max(1, Math.round(bounds.bottom - bounds.top));
        console.log(`[pixels-rgba] Layer bounds: ${layerW}x${layerH}`);

        // 只传一个维度，让 PS 自动按比例缩放保持纵横比（同 remove-background 的策略）
        let targetSize: Record<string, number>;
        if (maxSize > 0 && Math.max(layerW, layerH) > maxSize) {
            targetSize = layerW >= layerH
                ? { width: maxSize }
                : { height: maxSize };
        } else {
            targetSize = layerW >= layerH
                ? { width: layerW }
                : { height: layerH };
        }

        // 关键调用：传入 layerID 让 PS 只渲染目标图层的 composite，自带 alpha
        let pixelResult: any;
        try {
            pixelResult = await imaging.getPixels({
                documentID: docId,
                layerID: layerId,
                targetSize: targetSize as any
            });
        } catch (getPixelsError: any) {
            throw new Error(
                `imaging.getPixels({ layerID=${layerId} }) failed: ${getPixelsError?.message || getPixelsError}`
            );
        }

        if (!pixelResult?.imageData) {
            throw new Error('imaging.getPixels returned empty imageData');
        }

        const imgData = pixelResult.imageData;
        const width = imgData.width;
        const height = imgData.height;
        const components = imgData.components;
        const componentSize = imgData.componentSize || 8;

        if (componentSize !== 8) {
            imgData.dispose();
            throw new Error(`Unsupported componentSize=${componentSize}, only 8-bit per channel is supported in pixels-rgba mode`);
        }

        const sourceData = await imgData.getData();
        const sourceBytes = sourceData instanceof Uint8Array
            ? sourceData
            : new Uint8Array(sourceData as ArrayBuffer);

        const totalPixels = width * height;

        // 统一输出 RGBA（4 通道）：如果 PS 返回 RGB（3 通道），补全 alpha=255
        let rawPixels: Uint8Array;
        if (components === 4) {
            rawPixels = new Uint8Array(totalPixels * 4);
            rawPixels.set(sourceBytes.subarray(0, totalPixels * 4));
        } else if (components === 3) {
            rawPixels = new Uint8Array(totalPixels * 4);
            for (let i = 0; i < totalPixels; i++) {
                rawPixels[i * 4]     = sourceBytes[i * 3];
                rawPixels[i * 4 + 1] = sourceBytes[i * 3 + 1];
                rawPixels[i * 4 + 2] = sourceBytes[i * 3 + 2];
                rawPixels[i * 4 + 3] = 255;
            }
        } else {
            imgData.dispose();
            throw new Error(`Unsupported components=${components}, expect 3 (RGB) or 4 (RGBA)`);
        }

        imgData.dispose();

        outResult = {
            rawPixels,
            width,
            height,
            components: 4,
            componentSize
        };
    }, { commandName: 'DesignEcho: 抓取图层 RGBA 像素（零文档操作）' });

    if (!outResult) {
        throw new Error('exportUsingPixelsRGBA produced no result');
    }
    return outResult;
}

export class ExportLayerAsBase64Tool {
    name = 'exportLayerAsBase64';

    schema = {
        name: 'exportLayerAsBase64',
        description: '导出图层为 Base64 / Raw 像素（支持 imaging / native-png / pixels-rgba 三种模式）',
        parameters: {
            type: 'object' as const,
            properties: {
                layerId: { type: 'number', description: '图层 ID' },
                mode: {
                    type: 'string',
                    description: '导出模式：imaging=UXP JPEG（快）；native-png=PS 原生 saveAs PNG（无损）；pixels-rgba=零文档操作抓 raw RGBA（无感最优）',
                    enum: ['imaging', 'native-png', 'pixels-rgba']
                },
                format: {
                    type: 'string',
                    description: '图像格式（仅 imaging 模式下生效；当前实际统一编码为 JPEG）',
                    enum: ['png', 'jpeg']
                },
                quality: { type: 'number', description: 'JPEG 质量 (0-100)，保留参数' },
                maxSize: { type: 'number', description: '最大尺寸（像素），超出会等比缩放' }
            },
            required: ['layerId']
        }
    };

    async execute(params: ExportLayerParams): Promise<ToolResult<ExportLayerResult>> {
        return exportLayerAsBase64(params);
    }
}

// Preserve unused import warning suppression — `action` is retained for potential future JSX-less paths.
void action;
