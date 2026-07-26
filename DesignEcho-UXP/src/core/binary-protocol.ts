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
    const buffer = new ArrayBuffer(BINARY_HEADER_SIZE);
    const view = new DataView(buffer);
    
    view.setUint8(0, header.type);
    view.setUint32(1, header.requestId, true);  // little-endian
    view.setUint32(5, header.width, true);
    view.setUint32(9, header.height, true);
    // [13-15] 保留，填 0
    
    return new Uint8Array(buffer);
}

/**
 * 解码二进制消息头部
 */
export function decodeBinaryHeader(data: ArrayBuffer | Uint8Array): BinaryHeader {
    const buffer = data instanceof ArrayBuffer ? data : data.buffer;
    const view = new DataView(buffer);
    
    return {
        type: view.getUint8(0) as BinaryMessageType,
        requestId: view.getUint32(1, true),
        width: view.getUint32(5, true),
        height: view.getUint32(9, true)
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
    imageData: Uint8Array
): Uint8Array {
    const header = encodeBinaryHeader({ type, requestId, width, height });
    
    // 合并头部和数据
    const message = new Uint8Array(BINARY_HEADER_SIZE + imageData.length);
    message.set(header, 0);
    message.set(imageData, BINARY_HEADER_SIZE);
    
    return message;
}

/**
 * 解析二进制消息
 */
export function parseBinaryMessage(data: ArrayBuffer | Uint8Array): {
    header: BinaryHeader;
    imageData: Uint8Array;
} {
    const uint8Data = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
    
    const header = decodeBinaryHeader(uint8Data.slice(0, BINARY_HEADER_SIZE));
    const imageData = uint8Data.slice(BINARY_HEADER_SIZE);
    
    return { header, imageData };
}

/**
 * 检查是否为二进制消息（用于接收端判断）
 * 
 * 判断依据：
 * 1. 数据长度 >= 16（头部大小）
 * 2. 第一个字节是有效的消息类型（0x01-0x06）
 */
export function isBinaryMessage(data: ArrayBuffer | Uint8Array): boolean {
    const uint8Data = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
    
    if (uint8Data.length < BINARY_HEADER_SIZE) {
        return false;
    }
    
    const firstByte = uint8Data[0];
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
