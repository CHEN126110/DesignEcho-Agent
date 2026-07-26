/**
 * 稀疏位移场压缩与传输
 * 
 * 只存储边缘带区域的位移数据，大幅减少传输量
 * 2000×2000 图像: 32MB → 4MB (8x 压缩)
 */

import { DisplacementField, SparseDisplacementField } from './types';

/**
 * 量化精度 (存储值 = 实际值 × QUANTIZATION_SCALE)
 */
const QUANTIZATION_SCALE = 100;

/**
 * 最大位移 (像素)
 */
const MAX_DISPLACEMENT = 327;  // Int16 max / QUANTIZATION_SCALE

/**
 * 将完整位移场压缩为稀疏格式
 * @param field 完整位移场
 * @param weights 边缘带权重 (权重 > 0 的像素才保存)
 * @param threshold 权重阈值
 * @returns 稀疏位移场
 */
export function compressDisplacementField(
    field: DisplacementField,
    weights: Float32Array,
    threshold: number = 0.001
): SparseDisplacementField {
    console.log(`[SparseDisp] 开始压缩位移场 ${field.width}×${field.height}`);
    const startTime = performance.now();
    
    // 1. 统计有效像素数
    let pixelCount = 0;
    for (let i = 0; i < weights.length; i++) {
        if (weights[i] > threshold) {
            pixelCount++;
        }
    }
    
    console.log(`[SparseDisp] 边缘带像素: ${pixelCount} / ${weights.length} (${(pixelCount / weights.length * 100).toFixed(1)}%)`);
    
    // 2. 分配稀疏数组
    const indices = new Uint32Array(pixelCount);
    const dx = new Int16Array(pixelCount);
    const dy = new Int16Array(pixelCount);
    
    // 3. 填充数据
    let sparseIdx = 0;
    for (let i = 0; i < weights.length; i++) {
        if (weights[i] > threshold) {
            indices[sparseIdx] = i;
            
            // 量化位移
            const dxValue = field.dx[i];
            const dyValue = field.dy[i];
            
            // 限制范围并量化
            dx[sparseIdx] = Math.round(
                Math.max(-MAX_DISPLACEMENT, Math.min(MAX_DISPLACEMENT, dxValue)) * QUANTIZATION_SCALE
            );
            dy[sparseIdx] = Math.round(
                Math.max(-MAX_DISPLACEMENT, Math.min(MAX_DISPLACEMENT, dyValue)) * QUANTIZATION_SCALE
            );
            
            sparseIdx++;
        }
    }
    
    // 4. 计算校验和
    const checksum = computeChecksum(indices, dx, dy);
    
    const duration = performance.now() - startTime;
    const originalSize = field.width * field.height * 8;  // 2 × Float32
    const compressedSize = pixelCount * 10;  // Uint32 + 2 × Int16
    const ratio = originalSize / compressedSize;
    
    console.log(`[SparseDisp] ✅ 压缩完成: ${(originalSize / 1024).toFixed(0)}KB → ${(compressedSize / 1024).toFixed(0)}KB (${ratio.toFixed(1)}x), 耗时 ${duration.toFixed(2)}ms`);
    
    return {
        width: field.width,
        height: field.height,
        pixelCount,
        indices,
        dx,
        dy,
        checksum
    };
}

/**
 * 解压稀疏位移场为完整格式
 * @param sparse 稀疏位移场
 * @returns 完整位移场
 */
export function decompressDisplacementField(
    sparse: SparseDisplacementField
): DisplacementField {
    console.log(`[SparseDisp] 解压位移场 ${sparse.width}×${sparse.height}`);
    const startTime = performance.now();
    
    // 1. 验证校验和
    const expectedChecksum = computeChecksum(sparse.indices, sparse.dx, sparse.dy);
    if (expectedChecksum !== sparse.checksum) {
        console.warn(`[SparseDisp] ⚠️ 校验和不匹配: ${sparse.checksum} vs ${expectedChecksum}`);
    }
    
    // 2. 创建完整数组
    const size = sparse.width * sparse.height;
    const dx = new Float32Array(size);
    const dy = new Float32Array(size);
    
    // 3. 填充数据
    for (let i = 0; i < sparse.pixelCount; i++) {
        const idx = sparse.indices[i];
        dx[idx] = sparse.dx[i] / QUANTIZATION_SCALE;
        dy[idx] = sparse.dy[i] / QUANTIZATION_SCALE;
    }
    
    const duration = performance.now() - startTime;
    console.log(`[SparseDisp] ✅ 解压完成, 耗时 ${duration.toFixed(2)}ms`);
    
    return {
        width: sparse.width,
        height: sparse.height,
        dx,
        dy
    };
}

/**
 * 将稀疏位移场序列化为 Base64
 */
export function serializeSparseDisplacement(sparse: SparseDisplacementField): string {
    console.log(`[SparseDisp] 序列化稀疏位移场`);
    
    // 构建二进制数据
    // 格式: [header(24 bytes)] + [indices] + [dx] + [dy]
    const headerSize = 24;  // 6 × 4 bytes
    const dataSize = sparse.pixelCount * (4 + 2 + 2);  // Uint32 + Int16 + Int16
    const totalSize = headerSize + dataSize;
    
    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);
    
    // 写入头部
    view.setUint32(0, sparse.width, true);
    view.setUint32(4, sparse.height, true);
    view.setUint32(8, sparse.pixelCount, true);
    view.setUint32(12, sparse.checksum, true);
    // 保留 8 bytes
    
    // 写入数据
    let offset = headerSize;
    
    for (let i = 0; i < sparse.pixelCount; i++) {
        view.setUint32(offset, sparse.indices[i], true);
        offset += 4;
    }
    
    for (let i = 0; i < sparse.pixelCount; i++) {
        view.setInt16(offset, sparse.dx[i], true);
        offset += 2;
    }
    
    for (let i = 0; i < sparse.pixelCount; i++) {
        view.setInt16(offset, sparse.dy[i], true);
        offset += 2;
    }
    
    // 转换为 Base64（使用 Buffer 避免 btoa InvalidCharacterError）
    const bytes = new Uint8Array(buffer);
    const base64 = Buffer.from(bytes).toString('base64');
    console.log(`[SparseDisp] 序列化完成: ${(base64.length / 1024).toFixed(1)}KB`);
    
    return `SPARSE:${base64}`;
}

/**
 * 从 Base64 反序列化稀疏位移场
 */
export function deserializeSparseDisplacement(data: string): SparseDisplacementField {
    if (!data.startsWith('SPARSE:')) {
        throw new Error('Invalid sparse displacement format');
    }
    
    const base64 = data.substring(7).replace(/[^A-Za-z0-9+/=]/g, '');
    const buf = Buffer.from(base64, 'base64');
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    
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
    
    console.log(`[SparseDisp] 反序列化完成: ${width}×${height}, ${pixelCount} 像素`);
    
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
 * 计算校验和 (简单 CRC)
 */
function computeChecksum(
    indices: Uint32Array,
    dx: Int16Array,
    dy: Int16Array
): number {
    let sum = 0;
    
    for (let i = 0; i < indices.length; i++) {
        sum = (sum + indices[i]) >>> 0;
    }
    
    for (let i = 0; i < dx.length; i++) {
        sum = (sum + dx[i] + 32768) >>> 0;  // 转换为正数
    }
    
    for (let i = 0; i < dy.length; i++) {
        sum = (sum + dy[i] + 32768) >>> 0;
    }
    
    return sum;
}

/**
 * 验证稀疏位移场完整性
 */
export function validateSparseDisplacement(sparse: SparseDisplacementField): boolean {
    const expectedChecksum = computeChecksum(sparse.indices, sparse.dx, sparse.dy);
    const valid = expectedChecksum === sparse.checksum;
    
    if (!valid) {
        console.error(`[SparseDisp] 校验失败: 期望 ${sparse.checksum}, 实际 ${expectedChecksum}`);
    }
    
    return valid;
}

/**
 * 获取压缩统计信息
 */
export function getCompressionStats(
    originalField: DisplacementField,
    sparseField: SparseDisplacementField
): {
    originalSize: number;
    compressedSize: number;
    ratio: number;
    coverage: number;
} {
    const originalSize = originalField.width * originalField.height * 8;
    const compressedSize = sparseField.pixelCount * 8;  // 近似
    
    return {
        originalSize,
        compressedSize,
        ratio: originalSize / compressedSize,
        coverage: sparseField.pixelCount / (sparseField.width * sparseField.height)
    };
}
