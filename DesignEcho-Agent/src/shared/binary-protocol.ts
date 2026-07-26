/**
 * 二进制传输协议
 *
 * 用于 WebSocket 图像数据的高效传输
 * 参考 sd-ppp 设计，使用 Uint8Array 替代 Base64
 *
 * 优势：
 * 1. 无 Base64 膨胀（节省约 33% 数据量）
 * 2. 更快的序列化/反序列化
 * 3. 更低的内存占用
 */

/**
 * 二进制消息类型
 */
export enum BinaryMessageType {
    /** JPEG 图像数据 */
    JPEG = 0x01,
    /** PNG 图像数据 */
    PNG = 0x02,
    /** RAW 灰度蒙版（单通道，用于加图结果） */
    RAW_MASK = 0x03,
    /** RAW RGBA 数据 */
    RAW_RGBA = 0x04,
    /** RAW RGB 数据（无 Alpha） */
    RAW_RGB = 0x05,
    /** Inpainting result PNG */
    INPAINT_PNG = 0x06
}

/**
 * 二进制消息头部
 *
 * 格式（总计 16 字节）：
 * - [0]: 消息类型（1 字节）
 * - [1-4]: 请求 ID（4 字节，uint32）
 * - [5-8]: 宽度（4 字节，uint32）
 * - [9-12]: 高度（4 字节，uint32）
 * - [13-15]: 保留（3 字节）
 */
export const BINARY_HEADER_SIZE = 16;

/**
 * 二进制消息头部结构
 */
export interface BinaryHeader {
    type: BinaryMessageType;
    requestId: number;
    width: number;
    height: number;
}

/**
 * 编码二进制消息头部
 */
export function encodeBinaryHeader(header: BinaryHeader): Uint8Array {
    const buffer = Buffer.alloc(BINARY_HEADER_SIZE);

    buffer.writeUInt8(header.type, 0);
    buffer.writeUInt32LE(header.requestId, 1);
    buffer.writeUInt32LE(header.width, 5);
    buffer.writeUInt32LE(header.height, 9);
    // [13-15] 保留，填 0

    return new Uint8Array(buffer);
}

/**
 * 解码二进制消息头部
 */
export function decodeBinaryHeader(data: Buffer | Uint8Array): BinaryHeader {
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);

    return {
        type: buffer.readUInt8(0) as BinaryMessageType,
        requestId: buffer.readUInt32LE(1),
        width: buffer.readUInt32LE(5),
        height: buffer.readUInt32LE(9)
    };
}

/**
 * 创建完整的二进制消息
 */
export function createBinaryMessage(
    type: BinaryMessageType,
    requestId: number,
    width: number,
    height: number,
    imageData: Buffer | Uint8Array
): Buffer {
    const header = encodeBinaryHeader({ type, requestId, width, height });

    // Concatenate header and binary payload.
    return Buffer.concat([
        Buffer.from(header),
        Buffer.isBuffer(imageData) ? imageData : Buffer.from(imageData)
    ]);
}

/**
 * 解析二进制消息
 */
export function parseBinaryMessage(data: Buffer | Uint8Array): {
    header: BinaryHeader;
    imageData: Buffer;
} {
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);

    const header = decodeBinaryHeader(buffer.subarray(0, BINARY_HEADER_SIZE));
    const imageData = buffer.subarray(BINARY_HEADER_SIZE);

    return { header, imageData };
}

/**
 * 检查是否为二进制消息（用于接收端判断）
 *
 * 判断依据：
 * 1. 数据长度 >= 16（头部大小）
 * 2. 第一个字节是有效的消息类型（0x01-0x06）
 */
export function isBinaryMessage(data: Buffer | Uint8Array): boolean {
    if (data.length < BINARY_HEADER_SIZE) {
        return false;
    }

    const firstByte = data[0];
    return firstByte >= 0x01 && firstByte <= 0x06;
}

/**
 * 获取消息类型名称（用于日志）
 */
export function getBinaryTypeName(type: BinaryMessageType): string {
    switch (type) {
        case BinaryMessageType.JPEG: return 'JPEG';
        case BinaryMessageType.PNG: return 'PNG';
        case BinaryMessageType.RAW_MASK: return 'RAW_MASK';
        case BinaryMessageType.RAW_RGBA: return 'RAW_RGBA';
        case BinaryMessageType.RAW_RGB: return 'RAW_RGB';
        case BinaryMessageType.INPAINT_PNG: return 'INPAINT_PNG';
        default: return `UNKNOWN(${type})`;
    }
}

/**
 * 解析蒙版格式，提取尺寸和数据
 *
 * 支持的格式：
 * - RAW_MASK:width:height:base64data - RAW 灰度蒙版
 * - PNG_MASK:width:height:base64data - PNG 编码蒙版
 * - data:image/xxx;base64,xxx - Data URI 格式（尺寸未知）
 * - 纯 Base64 字符串（尺寸未知）
 */
export function parseMaskData(maskData: string): {
    buffer: Buffer;
    width: number | null;
    height: number | null;
    format: 'RAW_MASK' | 'PNG_MASK' | 'DATA_URI' | 'BASE64';
} {
    // 处理 RAW_MASK 格式: RAW_MASK:width:height:base64data
    if (maskData.startsWith('RAW_MASK:')) {
        const parts = maskData.split(':');
        const width = parseInt(parts[1], 10);
        const height = parseInt(parts[2], 10);
        const base64Data = parts.slice(3).join(':');
        return {
            buffer: Buffer.from(base64Data, 'base64'),
            width,
            height,
            format: 'RAW_MASK'
        };
    }

    // 处理 PNG_MASK 格式: PNG_MASK:width:height:base64data
    if (maskData.startsWith('PNG_MASK:')) {
        const parts = maskData.split(':');
        const width = parseInt(parts[1], 10);
        const height = parseInt(parts[2], 10);
        const base64Data = parts.slice(3).join(':');
        return {
            buffer: Buffer.from(base64Data, 'base64'),
            width,
            height,
            format: 'PNG_MASK'
        };
    }

    // 处理 Data URI 格式
    if (maskData.startsWith('data:')) {
        const cleanBase64 = maskData.replace(/^data:[^;]+;base64,/, '');
        return {
            buffer: Buffer.from(cleanBase64, 'base64'),
            width: null,
            height: null,
            format: 'DATA_URI'
        };
    }

    // 纯 Base64
    return {
        buffer: Buffer.from(maskData, 'base64'),
        width: null,
        height: null,
        format: 'BASE64'
    };
}

/**
 * Base64 转 Buffer（兼容多种蒙版格式）
 *
 * 支持的格式：
 * - RAW_MASK:width:height:base64data - RAW 灰度蒙版
 * - PNG_MASK:width:height:base64data - PNG 编码蒙版
 * - data:image/xxx;base64,xxx - Data URI 格式
 * - 纯 Base64 字符串
 */
export function base64ToBuffer(base64: string): Buffer {
    return parseMaskData(base64).buffer;
}

/**
 * Buffer 转 Base64（兼容旧格式）
 */
export function bufferToBase64(buffer: Buffer, mimeType: string = 'image/png'): string {
    return `data:${mimeType};base64,${buffer.toString('base64')}`;
}

// ==================== 全程二进制传输支持 ====================

/**
 * 二进制图像数据类型（用于内部传递）
 *
 * 设计目标：消除 Agent 内部的 Base64 转换开销
 * 参考 sd-ppp 的 JPEG + Alpha 分离传输策略
 */
export type BinaryImageFormat = 'jpeg' | 'png' | 'raw_rgb' | 'raw_rgba' | 'raw_mask';

/**
 * 二进制图像数据接口
 *
 * 用于 Agent 内部传递图像数据，避免 Base64 转换
 * - MattingService.removeBackground 接收此接口
 * - ONNX 推理服务使用 Buffer 处理
 */
export interface BinaryImageData {
    /** 图像格式 */
    format: BinaryImageFormat;
    /** 二进制数据（不做 Base64 转换） */
    buffer: Buffer;
    /** 图像宽度 */
    width: number;
    /** 图像高度 */
    height: number;
    /** 通道数（仅 RAW 格式需要） */
    channels?: 3 | 4 | 1;
}

/**
 * 检查是否为 BinaryImageData 对象
 */
export function isBinaryImageData(data: unknown): data is BinaryImageData {
    if (typeof data !== 'object' || data === null) return false;
    const obj = data as Record<string, unknown>;
    return (
        typeof obj.format === 'string' &&
        Buffer.isBuffer(obj.buffer) &&
        typeof obj.width === 'number' &&
        typeof obj.height === 'number'
    );
}

/**
 * 从 BinaryMessageType 转换为 BinaryImageFormat
 */
export function binaryTypeToFormat(type: BinaryMessageType): BinaryImageFormat {
    switch (type) {
        case BinaryMessageType.JPEG: return 'jpeg';
        case BinaryMessageType.PNG: return 'png';
        case BinaryMessageType.RAW_RGB: return 'raw_rgb';
        case BinaryMessageType.RAW_RGBA: return 'raw_rgba';
        case BinaryMessageType.RAW_MASK: return 'raw_mask';
        default: return 'jpeg';
    }
}

/**
 * 从缓存的二进制图像创建 BinaryImageData
 */
export function createBinaryImageData(
    type: BinaryMessageType,
    buffer: Buffer,
    width: number,
    height: number
): BinaryImageData {
    const format = binaryTypeToFormat(type);
    const channels = format === 'raw_rgb' ? 3 :
                     format === 'raw_rgba' ? 4 :
                     format === 'raw_mask' ? 1 : undefined;

    return {
        format,
        buffer,
        width,
        height,
        ...(channels !== undefined && { channels })
    };
}

/**
 * BinaryImageData 转换为 Base64 字符串（兼容旧代码）
 *
 * 仅在需要兼容旧接口时使用
 */
export function binaryImageDataToBase64(data: BinaryImageData): string {
    switch (data.format) {
        case 'jpeg':
            return `data:image/jpeg;base64,${data.buffer.toString('base64')}`;
        case 'png':
            return `data:image/png;base64,${data.buffer.toString('base64')}`;
        case 'raw_rgb':
            return `RAW:${data.width}:${data.height}:3:${data.buffer.toString('base64')}`;
        case 'raw_rgba':
            return `RAW:${data.width}:${data.height}:4:${data.buffer.toString('base64')}`;
        case 'raw_mask':
            return `RAW_MASK:${data.width}:${data.height}:${data.buffer.toString('base64')}`;
        default:
            return `data:image/png;base64,${data.buffer.toString('base64')}`;
    }
}

/**
 * 从 Base64 字符串解析为 BinaryImageData（兼容旧数据）
 */
export function base64ToBinaryImageData(base64: string): BinaryImageData | null {
    // RAW 格式: RAW:width:height:channels:base64data
    if (base64.startsWith('RAW:')) {
        const parts = base64.split(':');
        if (parts.length >= 5) {
            const width = parseInt(parts[1], 10);
            const height = parseInt(parts[2], 10);
            const channels = parseInt(parts[3], 10) as 3 | 4;
            const b64Data = parts.slice(4).join(':');
            return {
                format: channels === 4 ? 'raw_rgba' : 'raw_rgb',
                buffer: Buffer.from(b64Data, 'base64'),
                width,
                height,
                channels
            };
        }
    }

    // RAW_MASK 格式: RAW_MASK:width:height:base64data
    if (base64.startsWith('RAW_MASK:')) {
        const parts = base64.split(':');
        if (parts.length >= 4) {
            const width = parseInt(parts[1], 10);
            const height = parseInt(parts[2], 10);
            const b64Data = parts.slice(3).join(':');
            return {
                format: 'raw_mask',
                buffer: Buffer.from(b64Data, 'base64'),
                width,
                height,
                channels: 1
            };
        }
    }

    // Data URI 格式
    if (base64.startsWith('data:image/jpeg')) {
        const b64Data = base64.replace(/^data:image\/jpeg;base64,/, '');
        return {
            format: 'jpeg',
            buffer: Buffer.from(b64Data, 'base64'),
            width: 0,
            height: 0
        };
    }

    if (base64.startsWith('data:image/png')) {
        const b64Data = base64.replace(/^data:image\/png;base64,/, '');
        return {
            format: 'png',
            buffer: Buffer.from(b64Data, 'base64'),
            width: 0,
            height: 0
        };
    }

    return null;
}
