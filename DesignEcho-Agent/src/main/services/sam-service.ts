/**
 * SAM (Segment Anything Model) 服务
 * 
 * 支持 Box Prompt 的交互式分割，用于选区抠图功能
 * 
 * 工作流程：
 * 1. Image Encoder: 将图像编码为特征向量（可缓存）
 * 2. Prompt Encoder + Mask Decoder: 根据 box/point prompt 生成蒙版
 * 
 * 模型版本：
 * - MobileSAM: 轻量级版本，~40MB，推理快
 * - SAM ViT-B: 标准版本，~375MB，精度更高
 */

import * as path from 'path';
import * as fs from 'fs';

// ==================== 类型定义 ====================

export interface SAMConfig {
    modelsDir?: string;
    modelType?: 'mobile_sam' | 'sam_vit_b' | 'sam2_large';
}

export interface BoxPrompt {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
}

export interface PointPrompt {
    x: number;
    y: number;
    label: 0 | 1;  // 0: 背景点, 1: 前景点
}

export interface SAMResult {
    success: boolean;
    mask?: Buffer;  // 灰度蒙版 (0-255)
    maskWidth?: number;
    maskHeight?: number;
    processingTime?: number;
    error?: string;
}

// ==================== 常量 ====================

const SAM_INPUT_SIZE = 1024;  // SAM 标准输入尺寸

// ==================== SAM 服务类 ====================

export class SAMService {
    private modelsDir: string;
    private modelType: 'mobile_sam' | 'sam_vit_b' | 'sam2_large';
    
    // ONNX Runtime 和 Sharp
    private ort: any = null;
    private sharp: any = null;
    
    // SAM 模型 Sessions
    private encoderSession: any = null;
    private decoderSession: any = null;
    
    // 图像嵌入缓存（同一图像多次选区可复用）
    private imageEmbeddingCache: Map<string, {
        embedding: any;
        originalWidth: number;
        originalHeight: number;
        timestamp: number;
    }> = new Map();
    
    // 缓存过期时间（5分钟）
    private readonly CACHE_EXPIRY_MS = 5 * 60 * 1000;
    
    constructor(config: SAMConfig = {}) {
        this.modelsDir = config.modelsDir || path.join(process.cwd(), 'models');
        
        // 自动检测最佳可用模型
        if (config.modelType) {
            this.modelType = config.modelType;
        } else {
            // 优先使用 SAM2.1-Large（如果可用）
            const sam2EncoderPath = path.join(this.modelsDir, 'sam2', 'vision_encoder_fp16.onnx');
            const sam2DecoderPath = path.join(this.modelsDir, 'sam2', 'prompt_encoder_mask_decoder_fp16.onnx');
            
            if (fs.existsSync(sam2EncoderPath) && fs.existsSync(sam2DecoderPath)) {
                this.modelType = 'sam2_large';
                console.log('[SAMService] 检测到 SAM2.1-Large 模型，优先使用');
            } else {
                this.modelType = 'mobile_sam';
            }
        }
    }
    
    /**
     * 初始化 SAM 服务
     */
    async initialize(): Promise<boolean> {
        try {
            // 动态导入依赖
            this.ort = require('onnxruntime-node');
            this.sharp = require('sharp');
            
            // 检查模型文件
            const encoderPath = this.getEncoderPath();
            const decoderPath = this.getDecoderPath();
            
            if (!fs.existsSync(encoderPath)) {
                console.log(`[SAMService] Encoder 模型不存在: ${encoderPath}`);
                return false;
            }
            
            if (!fs.existsSync(decoderPath)) {
                console.log(`[SAMService] Decoder 模型不存在: ${decoderPath}`);
                return false;
            }
            
            console.log('[SAMService] 正在加载 SAM 模型...');
            
            // 加载 Encoder
            const encoderStart = Date.now();
            this.encoderSession = await this.ort.InferenceSession.create(encoderPath, {
                executionProviders: ['cpu'],
                graphOptimizationLevel: 'all',
                logSeverityLevel: 3  // 抑制警告，只显示错误
            });
            console.log(`[SAMService] ✅ Encoder 加载完成 (${Date.now() - encoderStart}ms)`);
            
            // 加载 Decoder
            const decoderStart = Date.now();
            this.decoderSession = await this.ort.InferenceSession.create(decoderPath, {
                executionProviders: ['cpu'],
                graphOptimizationLevel: 'all',
                logSeverityLevel: 3  // 抑制警告，只显示错误
            });
            console.log(`[SAMService] ✅ Decoder 加载完成 (${Date.now() - decoderStart}ms)`);
            
            // 启动缓存清理定时器
            this.startCacheCleanup();
            
            const modelName = this.modelType === 'sam2_large' ? 'SAM2.1-Large' : 
                             this.modelType === 'mobile_sam' ? 'MobileSAM' : 'SAM ViT-B';
            console.log(`[SAMService] ✅ SAM 服务初始化完成，使用 ${modelName}`);
            return true;
            
        } catch (error: any) {
            console.error('[SAMService] 初始化失败:', error.message);
            return false;
        }
    }
    
    /**
     * 检查模型是否已加载
     */
    isReady(): boolean {
        return this.encoderSession !== null && this.decoderSession !== null;
    }
    
    /**
     * 检查模型文件是否存在
     */
    checkModelsExist(): { encoder: boolean; decoder: boolean } {
        return {
            encoder: fs.existsSync(this.getEncoderPath()),
            decoder: fs.existsSync(this.getDecoderPath())
        };
    }
    
    /**
     * 使用 Box Prompt 进行分割
     * 
     * @param imageBuffer - 输入图像 (PNG/JPEG Buffer)
     * @param box - 边界框提示 [x1, y1, x2, y2]
     * @param centerPoint - 可选的中心点提示，增强分割精度
     */
    async segmentWithBox(
        imageBuffer: Buffer,
        box: BoxPrompt,
        centerPoint?: PointPrompt
    ): Promise<SAMResult> {
        if (!this.isReady()) {
            return { success: false, error: 'SAM 模型未加载' };
        }
        
        const startTime = Date.now();
        
        try {
            // 1. 获取图像元数据
            const metadata = await this.sharp(imageBuffer).metadata();
            const originalWidth = metadata.width!;
            const originalHeight = metadata.height!;
            
            console.log(`[SAMService] 输入图像: ${originalWidth}x${originalHeight}`);
            console.log(`[SAMService] Box Prompt: (${box.x1}, ${box.y1}) - (${box.x2}, ${box.y2})`);
            
            // 2. 生成图像哈希用于缓存
            const imageHash = this.hashBuffer(imageBuffer);
            
            // 3. 获取或计算图像嵌入（encoderOutputs 包含 image_embeddings 和 image_positional_embeddings）
            let encoderOutputs: Record<string, any>;
            const cached = this.imageEmbeddingCache.get(imageHash);
            
            if (cached && Date.now() - cached.timestamp < this.CACHE_EXPIRY_MS) {
                console.log('[SAMService] 使用缓存的图像嵌入');
                encoderOutputs = cached.embedding;
            } else {
                console.log('[SAMService] 计算图像嵌入...');
                const encodeStart = Date.now();
                encoderOutputs = await this.encodeImage(imageBuffer, originalWidth, originalHeight);
                console.log(`[SAMService] 图像嵌入完成 (${Date.now() - encodeStart}ms)`);
                
                // 缓存嵌入
                this.imageEmbeddingCache.set(imageHash, {
                    embedding: encoderOutputs,
                    originalWidth,
                    originalHeight,
                    timestamp: Date.now()
                });
            }
            
            // 4. 准备 Prompt 输入
            const prompts = this.preparePrompts(box, centerPoint, originalWidth, originalHeight);
            
            // 5. 运行 Decoder
            console.log('[SAMService] 运行 Mask Decoder...');
            const decodeStart = Date.now();
            const maskData = await this.decodeMask(encoderOutputs, prompts, originalWidth, originalHeight);
            console.log(`[SAMService] Decoder 完成 (${Date.now() - decodeStart}ms)`);
            
            // 6. 边缘清理：使用概率阈值而非形态学操作
            // 形态学开运算会导致边界收缩，改用更精细的阈值处理
            console.log('[SAMService] 边缘清理（概率阈值）...');
            const refineStart = Date.now();
            const refinedMask = this.refineMaskWithProbabilityThreshold(maskData.mask, originalWidth, originalHeight);
            console.log(`[SAMService] 边缘清理完成 (${Date.now() - refineStart}ms)`);
            
            const processingTime = Date.now() - startTime;
            console.log(`[SAMService] 总处理时间: ${processingTime}ms`);
            
            return {
                success: true,
                mask: refinedMask,
                maskWidth: originalWidth,
                maskHeight: originalHeight,
                processingTime
            };
            
        } catch (error: any) {
            console.error('[SAMService] 分割失败:', error.message);
            return { success: false, error: error.message };
        }
    }
    
    /**
     * 编码图像为特征向量
     * SlimSAM encoder 输出: image_embeddings, image_positional_embeddings
     */
    private async encodeImage(
        imageBuffer: Buffer,
        originalWidth: number,
        originalHeight: number
    ): Promise<Record<string, any>> {
        // 1. 预处理：调整到 1024x1024
        const resizedBuffer = await this.sharp(imageBuffer)
            .resize(SAM_INPUT_SIZE, SAM_INPUT_SIZE, {
                fit: 'fill',
                kernel: 'lanczos3'
            })
            .removeAlpha()
            .raw()
            .toBuffer();
        
        // 2. 转换为 Float32 张量 [1, 3, 1024, 1024]
        // SAM 使用 ImageNet 归一化
        const mean = [0.485, 0.456, 0.406];
        const std = [0.229, 0.224, 0.225];
        
        const inputTensor = new Float32Array(3 * SAM_INPUT_SIZE * SAM_INPUT_SIZE);
        
        for (let i = 0; i < SAM_INPUT_SIZE * SAM_INPUT_SIZE; i++) {
            const r = resizedBuffer[i * 3] / 255;
            const g = resizedBuffer[i * 3 + 1] / 255;
            const b = resizedBuffer[i * 3 + 2] / 255;
            
            inputTensor[i] = (r - mean[0]) / std[0];
            inputTensor[SAM_INPUT_SIZE * SAM_INPUT_SIZE + i] = (g - mean[1]) / std[1];
            inputTensor[2 * SAM_INPUT_SIZE * SAM_INPUT_SIZE + i] = (b - mean[2]) / std[2];
        }
        
        // 3. 运行 Encoder
        const feeds: Record<string, any> = {};
        const inputNames = this.encoderSession.inputNames;
        
        console.log('[SAMService] Encoder 输入名称:', inputNames);
        
        feeds[inputNames[0]] = new this.ort.Tensor(
            'float32',
            inputTensor,
            [1, 3, SAM_INPUT_SIZE, SAM_INPUT_SIZE]
        );
        
        const results = await this.encoderSession.run(feeds);
        
        const outputNames = this.encoderSession.outputNames;
        console.log('[SAMService] Encoder 输出名称:', outputNames);
        
        // 返回所有 encoder 输出（SlimSAM 有 image_embeddings 和 image_positional_embeddings）
        return results;
    }
    
    /**
     * 准备 Prompt 输入
     */
    private preparePrompts(
        box: BoxPrompt,
        centerPoint: PointPrompt | undefined,
        originalWidth: number,
        originalHeight: number
    ): {
        pointCoords: Float32Array;
        pointLabels: Float32Array;
        origImSize: Float32Array;
    } {
        // 缩放因子：原始图像 → 1024x1024
        const scaleX = SAM_INPUT_SIZE / originalWidth;
        const scaleY = SAM_INPUT_SIZE / originalHeight;
        
        // Box Prompt: 转换为两个点（左上角和右下角）
        const boxPoints = [
            box.x1 * scaleX,
            box.y1 * scaleY,
            box.x2 * scaleX,
            box.y2 * scaleY
        ];
        
        let numPoints = 2;
        let pointCoords: number[] = boxPoints;
        // SAM box prompt 标签: 2=左上角, 3=右下角
        // 这是 SAM 官方的 box prompt 编码
        let pointLabels: number[] = [2, 3];
        
        console.log(`[SAMService] Box 坐标 (缩放后): [${boxPoints.map(v => v.toFixed(1)).join(', ')}]`);
        console.log(`[SAMService] 点标签: [${pointLabels.join(', ')}]`);
        
        // 如果有中心点，添加到 prompts
        if (centerPoint) {
            pointCoords.push(centerPoint.x * scaleX, centerPoint.y * scaleY);
            pointLabels.push(centerPoint.label);
            numPoints = 3;
        }
        
        return {
            pointCoords: new Float32Array(pointCoords),
            pointLabels: new Float32Array(pointLabels),
            origImSize: new Float32Array([originalHeight, originalWidth])
        };
    }
    
    /**
     * 运行 Mask Decoder
     * SlimSAM decoder 输入: input_points, input_labels, image_embeddings, image_positional_embeddings
     */
    private async decodeMask(
        encoderOutputs: Record<string, any>,
        prompts: {
            pointCoords: Float32Array;
            pointLabels: Float32Array;
            origImSize: Float32Array;
        },
        originalWidth: number,
        originalHeight: number
    ): Promise<{ mask: Buffer }> {
        const numPoints = prompts.pointCoords.length / 2;
        
        // 准备 Decoder 输入
        const feeds: Record<string, any> = {};
        const inputNames = this.decoderSession.inputNames;
        
        console.log('[SAMService] Decoder 输入名称:', inputNames);
        
        // 根据模型类型构建不同的输入:
        // SAM2.1: input_boxes (边界框直接输入)
        // MobileSAM/SlimSAM: input_points + input_labels
        const isSAM2 = this.modelType === 'sam2_large';
        
        console.log('[SAMService] 使用模型类型:', this.modelType, 'isSAM2:', isSAM2);
        
        for (const name of inputNames) {
            // SAM2.1 边界框输入: input_boxes [1, num_boxes, 4]
            if (name === 'input_boxes') {
                // prompts.pointCoords 包含 box 的两个点: [x1, y1, x2, y2]
                // SAM2 需要 [x1, y1, x2, y2] 格式
                const boxData = new Float32Array(4);
                boxData[0] = prompts.pointCoords[0];  // x1
                boxData[1] = prompts.pointCoords[1];  // y1
                boxData[2] = prompts.pointCoords[2];  // x2
                boxData[3] = prompts.pointCoords[3];  // y2
                
                feeds[name] = new this.ort.Tensor(
                    'float32',
                    boxData,
                    [1, 1, 4]  // [batch, num_boxes, 4]
                );
                console.log('[SAMService] input_boxes:', Array.from(boxData));
            }
            // 点坐标输入 (SlimSAM: input_points 需要4维)
            else if (name === 'input_points') {
                feeds[name] = new this.ort.Tensor(
                    'float32',
                    prompts.pointCoords,
                    [1, 1, numPoints, 2]  // SlimSAM 需要 4 维
                );
            }
            // MobileSAM 兼容: point_coords 使用 3 维
            else if (name.includes('point_coord') || name === 'point_coords') {
                feeds[name] = new this.ort.Tensor(
                    'float32',
                    prompts.pointCoords,
                    [1, numPoints, 2]
                );
            }
            // 点标签输入 (SlimSAM: input_labels 需要3维, int64类型)
            else if (name === 'input_labels') {
                // 转换为 BigInt64Array
                const labelsInt64 = new BigInt64Array(prompts.pointLabels.length);
                for (let i = 0; i < prompts.pointLabels.length; i++) {
                    labelsInt64[i] = BigInt(Math.round(prompts.pointLabels[i]));
                }
                feeds[name] = new this.ort.Tensor(
                    'int64',
                    labelsInt64,
                    [1, 1, numPoints]  // SlimSAM 需要 3 维
                );
            }
            // MobileSAM 兼容: point_labels 使用 2 维, float32
            else if (name.includes('point_label') || name === 'point_labels') {
                feeds[name] = new this.ort.Tensor(
                    'float32',
                    prompts.pointLabels,
                    [1, numPoints]
                );
            }
            // SAM2.1 图像嵌入: 精确匹配 image_embeddings.0, .1, .2
            else if (name.startsWith('image_embeddings')) {
                if (encoderOutputs[name]) {
                    feeds[name] = encoderOutputs[name];
                }
            }
            // 位置嵌入 (SlimSAM/MobileSAM 特有)
            else if (name === 'image_positional_embeddings' || name.includes('positional')) {
                const posKey = Object.keys(encoderOutputs).find(k => 
                    k === 'image_positional_embeddings' || k.includes('positional')
                );
                if (posKey) {
                    feeds[name] = encoderOutputs[posKey];
                }
            }
            // 原始图像尺寸
            else if (name.includes('orig_im_size')) {
                feeds[name] = new this.ort.Tensor(
                    'float32',
                    prompts.origImSize,
                    [2]
                );
            }
            // 蒙版输入标志
            else if (name.includes('has_mask') || name === 'has_mask_input') {
                feeds[name] = new this.ort.Tensor('float32', new Float32Array([0]), [1]);
            }
            // 空蒙版输入
            else if (name.includes('mask_input')) {
                feeds[name] = new this.ort.Tensor(
                    'float32',
                    new Float32Array(256 * 256).fill(0),
                    [1, 1, 256, 256]
                );
            }
            // SAM2.1 特有输入: high_res_feats_0, high_res_feats_1 等
            else if (name.startsWith('high_res_feats')) {
                if (encoderOutputs[name]) {
                    feeds[name] = encoderOutputs[name];
                }
            }
            // 通用: 尝试直接从 encoder 输出匹配同名输入
            else if (encoderOutputs[name]) {
                feeds[name] = encoderOutputs[name];
            }
        }
        
        // 检查是否有未提供的必需输入
        const missingInputs = inputNames.filter(n => !feeds[n]);
        if (missingInputs.length > 0) {
            console.log('[SAMService] 警告: 未匹配的输入:', missingInputs);
            console.log('[SAMService] Encoder 输出键:', Object.keys(encoderOutputs));
        }
        
        console.log('[SAMService] Decoder feeds 包含的输入:', Object.keys(feeds));
        
        // 运行 Decoder
        const results = await this.decoderSession.run(feeds);
        
        const outputNames = this.decoderSession.outputNames;
        console.log('[SAMService] Decoder 输出名称:', outputNames);
        
        // 获取蒙版输出和 IoU 分数
        let maskOutput: any = null;
        let iouScores: any = null;
        
        for (const name of outputNames) {
            if (name.includes('mask') || name === 'masks' || name === 'pred_masks') {
                maskOutput = results[name];
            }
            if (name.includes('iou') || name === 'iou_scores') {
                iouScores = results[name];
            }
        }
        
        if (!maskOutput) {
            throw new Error('未找到蒙版输出');
        }
        
        const maskData = maskOutput.data as Float32Array;
        const maskDims = maskOutput.dims;
        
        console.log('[SAMService] 蒙版输出形状:', maskDims);
        
        // SlimSAM 输出形状: [1, 1, 3, 256, 256] (batch, query, num_masks, H, W)
        const maskH = maskDims[maskDims.length - 2];
        const maskW = maskDims[maskDims.length - 1];
        const singleMaskSize = maskH * maskW;
        const numMasks = maskDims.length >= 3 ? maskDims[maskDims.length - 3] : 1;
        
        // 选择最佳蒙版：使用 IoU 分数或默认第二个（通常效果最好）
        let bestMaskIndex = 1;  // 默认使用第二个蒙版（根据官方示例）
        
        if (iouScores) {
            const scores = iouScores.data as Float32Array;
            console.log('[SAMService] IoU 分数:', Array.from(scores));
            
            // 找到最高分的蒙版
            let maxScore = -Infinity;
            for (let i = 0; i < Math.min(numMasks, scores.length); i++) {
                if (scores[i] > maxScore) {
                    maxScore = scores[i];
                    bestMaskIndex = i;
                }
            }
            console.log(`[SAMService] 选择蒙版 ${bestMaskIndex}，IoU=${maxScore.toFixed(4)}`);
        }
        
        // 计算最佳蒙版的偏移量
        const maskOffset = bestMaskIndex * singleMaskSize;
        
        console.log(`[SAMService] 提取蒙版: 尺寸=${maskW}x${maskH}, 索引=${bestMaskIndex}, 偏移=${maskOffset}`);
        
        // ========== 核心改进：在 Logits 空间放大，然后应用 Sigmoid ==========
        // 这样边缘在 logit 空间中有更好的过渡，sigmoid 后边缘更自然
        
        // 记录原始 logits 范围
        let minLogit = Infinity, maxLogit = -Infinity;
        for (let i = 0; i < singleMaskSize; i++) {
            const logit = maskData[maskOffset + i];
            minLogit = Math.min(minLogit, logit);
            maxLogit = Math.max(maxLogit, logit);
        }
        console.log(`[SAMService] 原始蒙版 logits 范围: min=${minLogit.toFixed(2)}, max=${maxLogit.toFixed(2)}`);
        
        // Step 1: 在 logits 空间进行双三次插值放大（Bicubic，比双线性更平滑）
        console.log(`[SAMService] 在 Logits 空间放大蒙版（双三次插值）: ${maskW}x${maskH} -> ${originalWidth}x${originalHeight}`);
        
        const upscaledLogits = new Float32Array(originalWidth * originalHeight);
        const scaleX = maskW / originalWidth;
        const scaleY = maskH / originalHeight;
        
        // 双三次插值核函数
        const cubicWeight = (t: number): number => {
            const a = -0.5; // Catmull-Rom 参数
            const absT = Math.abs(t);
            if (absT <= 1) {
                return (a + 2) * absT * absT * absT - (a + 3) * absT * absT + 1;
            } else if (absT < 2) {
                return a * absT * absT * absT - 5 * a * absT * absT + 8 * a * absT - 4 * a;
            }
            return 0;
        };
        
        // 获取 logit 值（带边界检查）
        const getLogit = (x: number, y: number): number => {
            const cx = Math.max(0, Math.min(maskW - 1, x));
            const cy = Math.max(0, Math.min(maskH - 1, y));
            return maskData[maskOffset + cy * maskW + cx];
        };
        
        for (let dstY = 0; dstY < originalHeight; dstY++) {
            for (let dstX = 0; dstX < originalWidth; dstX++) {
                const srcX = dstX * scaleX;
                const srcY = dstY * scaleY;
                
                const intX = Math.floor(srcX);
                const intY = Math.floor(srcY);
                const fracX = srcX - intX;
                const fracY = srcY - intY;
                
                // 4x4 邻域双三次插值
                let sum = 0;
                let weightSum = 0;
                
                for (let j = -1; j <= 2; j++) {
                    for (let i = -1; i <= 2; i++) {
                        const weight = cubicWeight(fracX - i) * cubicWeight(fracY - j);
                        sum += getLogit(intX + i, intY + j) * weight;
                        weightSum += weight;
                    }
                }
                
                upscaledLogits[dstY * originalWidth + dstX] = sum / weightSum;
            }
        }
        
        // Step 2: 在高分辨率上应用 Sigmoid
        console.log('[SAMService] 应用 Sigmoid 转换...');
        
        const probMask = new Float32Array(originalWidth * originalHeight);
        
        for (let i = 0; i < upscaledLogits.length; i++) {
            const logit = upscaledLogits[i];
            // Sigmoid 转换：logit -> 概率 [0, 1]
            const prob = 1 / (1 + Math.exp(-logit));
            probMask[i] = prob;
        }
        
        // Step 3: 直接使用概率值生成蒙版，保持自然的边缘过渡
        // 问题分析：之前的窄阈值 (0.45-0.55) 导致边缘出现块状伪影
        // 解决方案：使用更宽的阈值范围，让 sigmoid 自然产生平滑边缘
        console.log('[SAMService] 生成蒙版（自然边缘过渡）...');
        
        const finalMask = Buffer.alloc(originalWidth * originalHeight);
        let whiteCount = 0, blackCount = 0, gradientCount = 0;
        
        // 使用更宽的阈值范围，让边缘更自然
        // sigmoid 输出在边缘处会有自然的 0.2-0.8 过渡
        const bgThreshold = 0.3;   // 低于此值 = 纯背景
        const fgThreshold = 0.7;   // 高于此值 = 纯前景
        
        for (let y = 0; y < originalHeight; y++) {
            for (let x = 0; x < originalWidth; x++) {
                const idx = y * originalWidth + x;
                const prob = probMask[idx];
                
                let value: number;
                if (prob < bgThreshold) {
                    value = 0;
                    blackCount++;
                } else if (prob > fgThreshold) {
                    value = 255;
                    whiteCount++;
                } else {
                    // 边缘区域：线性映射产生自然过渡
                    value = Math.round((prob - bgThreshold) / (fgThreshold - bgThreshold) * 255);
                    gradientCount++;
                }
                
                finalMask[idx] = value;
            }
        }
        
        console.log(`[SAMService] 蒙版生成: 前景=${whiteCount}, 背景=${blackCount}, 渐变边缘=${gradientCount}`);
        
        return { mask: finalMask };
    }
    
    /**
     * 边缘引导锐化 - 使用原图边缘信息增强 mask 边缘清晰度
     * 在原图边缘强的地方增强 mask 对比度，实现锐利边缘
     */
    private async refineEdgesWithGuidedFilter(
        mask: Buffer,
        imageBuffer: Buffer,
        width: number,
        height: number
    ): Promise<Buffer> {
        try {
            // 1. 获取原图灰度版本作为引导
            const guideBuffer = await this.sharp(imageBuffer)
                .resize(width, height, { fit: 'fill' })
                .grayscale()
                .raw()
                .toBuffer();
            
            const refinedMask = Buffer.alloc(width * height);
            
            // 获取像素值的辅助函数
            const getPixel = (buf: Buffer, x: number, y: number): number => {
                const cx = Math.max(0, Math.min(width - 1, x));
                const cy = Math.max(0, Math.min(height - 1, y));
                return buf[cy * width + cx];
            };
            
            // 使用 3x3 Sobel 边缘检测
            const sobelX = [[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]];
            const sobelY = [[-1, -2, -1], [0, 0, 0], [1, 2, 1]];
            
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const idx = y * width + x;
                    const currentMask = mask[idx];
                    
                    // 只处理边缘区域（mask 值在 10-245 之间）
                    if (currentMask > 10 && currentMask < 245) {
                        // 计算原图的边缘强度（3x3 窗口）
                        let gx = 0, gy = 0;
                        for (let wy = -1; wy <= 1; wy++) {
                            for (let wx = -1; wx <= 1; wx++) {
                                const pixel = getPixel(guideBuffer, x + wx, y + wy);
                                gx += pixel * sobelX[wy + 1][wx + 1];
                                gy += pixel * sobelY[wy + 1][wx + 1];
                            }
                        }
                        
                        const edgeStrength = Math.min(1, Math.sqrt(gx * gx + gy * gy) / 500);
                        
                        // 边缘锐化：在原图边缘强的地方，增强 mask 对比度
                        // 将 mask 值向 0 或 255 推
                        if (edgeStrength > 0.1) {
                            // 边缘处：增强对比度
                            if (currentMask > 127) {
                                // 偏白：推向 255
                                const boost = Math.min(255 - currentMask, edgeStrength * 50);
                                refinedMask[idx] = Math.round(currentMask + boost);
                            } else {
                                // 偏黑：推向 0
                                const boost = Math.min(currentMask, edgeStrength * 50);
                                refinedMask[idx] = Math.round(currentMask - boost);
                            }
                        } else {
                            // 非边缘处：保持原值
                            refinedMask[idx] = currentMask;
                        }
                    } else {
                        // 非边缘区域保持不变
                        refinedMask[idx] = currentMask;
                    }
                }
            }
            
            console.log('[SAMService] 边缘引导锐化完成');
            return refinedMask;
            
        } catch (error: any) {
            console.warn('[SAMService] 边缘引导锐化失败:', error.message);
            return mask;
        }
    }
    
    /**
     * 形态学腐蚀操作 - 收缩蒙版边缘，消除边界噪点
     */
    private erodeMask(mask: Buffer, width: number, height: number, iterations: number): Buffer {
        let currentMask = Buffer.from(mask);
        
        for (let iter = 0; iter < iterations; iter++) {
            const newMask = Buffer.alloc(width * height);
            
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const idx = y * width + x;
                    const centerValue = currentMask[idx];
                    
                    // 如果中心点是前景（>128）
                    if (centerValue > 128) {
                        // 检查 3x3 邻域，取最小值
                        let minNeighbor = centerValue;
                        
                        for (let dy = -1; dy <= 1; dy++) {
                            for (let dx = -1; dx <= 1; dx++) {
                                const nx = x + dx;
                                const ny = y + dy;
                                
                                if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                                    const neighborIdx = ny * width + nx;
                                    minNeighbor = Math.min(minNeighbor, currentMask[neighborIdx]);
                                }
                            }
                        }
                        
                        newMask[idx] = minNeighbor;
                    } else {
                        newMask[idx] = centerValue;
                    }
                }
            }
            
            currentMask = newMask;
        }
        
        return currentMask;
    }
    
    /**
     * 形态学膨胀操作 - 扩展蒙版边缘，恢复主体边界
     */
    private dilateMask(mask: Buffer, width: number, height: number, iterations: number): Buffer {
        let currentMask = Buffer.from(mask);
        
        for (let iter = 0; iter < iterations; iter++) {
            const newMask = Buffer.alloc(width * height);
            
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const idx = y * width + x;
                    const centerValue = currentMask[idx];
                    
                    // 检查 3x3 邻域，取最大值
                    let maxNeighbor = centerValue;
                    
                    for (let dy = -1; dy <= 1; dy++) {
                        for (let dx = -1; dx <= 1; dx++) {
                            const nx = x + dx;
                            const ny = y + dy;
                            
                            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                                const neighborIdx = ny * width + nx;
                                maxNeighbor = Math.max(maxNeighbor, currentMask[neighborIdx]);
                            }
                        }
                    }
                    
                    newMask[idx] = maxNeighbor;
                }
            }
            
            currentMask = newMask;
        }
        
        return currentMask;
    }
    
    /**
     * 边缘抗锯齿 - 仅对边界像素进行平滑，保持主体清晰
     * 
     * 核心思路：只在前景/背景交界处（1-2 像素宽度）做平滑
     * 避免整体模糊，保持边缘锐利
     */
    private antiAliasMaskEdges(mask: Buffer, width: number, height: number): Buffer {
        const result = Buffer.from(mask);
        
        // 3x3 高斯核（归一化）
        const kernel = [
            1, 2, 1,
            2, 4, 2,
            1, 2, 1
        ];
        const kernelSum = 16;
        
        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                const idx = y * width + x;
                const centerValue = mask[idx];
                
                // 检测是否是边界像素（邻域同时有前景和背景）
                let hasForeground = false;
                let hasBackground = false;
                
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        const neighborValue = mask[(y + dy) * width + (x + dx)];
                        if (neighborValue > 200) hasForeground = true;
                        if (neighborValue < 50) hasBackground = true;
                    }
                }
                
                // 只对边界像素应用高斯平滑
                if (hasForeground && hasBackground) {
                    let sum = 0;
                    let ki = 0;
                    
                    for (let dy = -1; dy <= 1; dy++) {
                        for (let dx = -1; dx <= 1; dx++) {
                            sum += mask[(y + dy) * width + (x + dx)] * kernel[ki++];
                        }
                    }
                    
                    result[idx] = Math.round(sum / kernelSum);
                }
            }
        }
        
        return result;
    }
    
    /**
     * 概率阈值精化 - 使用更智能的边界处理消除块状边缘和残留
     * 
     * 核心思路：
     * 1. 对孤立的噪点（周围大部分是背景）进行清除
     * 2. 对边界区域进行平滑过渡
     * 3. 不使用腐蚀操作，避免边界收缩
     */
    private refineMaskWithProbabilityThreshold(mask: Buffer, width: number, height: number): Buffer {
        const result = Buffer.from(mask);
        
        // Pass 1: 清除孤立噪点（5x5 窗口内少于 40% 为前景的像素视为噪点）
        for (let y = 2; y < height - 2; y++) {
            for (let x = 2; x < width - 2; x++) {
                const idx = y * width + x;
                const centerValue = mask[idx];
                
                // 只处理前景像素
                if (centerValue > 128) {
                    let foregroundCount = 0;
                    let totalCount = 0;
                    
                    for (let dy = -2; dy <= 2; dy++) {
                        for (let dx = -2; dx <= 2; dx++) {
                            const neighborValue = mask[(y + dy) * width + (x + dx)];
                            if (neighborValue > 128) foregroundCount++;
                            totalCount++;
                        }
                    }
                    
                    // 如果周围少于 40% 是前景，则视为噪点
                    if (foregroundCount / totalCount < 0.4) {
                        result[idx] = 0;
                    }
                }
            }
        }
        
        // Pass 2: 填充前景内部的小孔洞（5x5 窗口内超过 60% 为前景的背景像素）
        for (let y = 2; y < height - 2; y++) {
            for (let x = 2; x < width - 2; x++) {
                const idx = y * width + x;
                const centerValue = result[idx];
                
                // 只处理背景像素
                if (centerValue < 128) {
                    let foregroundCount = 0;
                    let totalCount = 0;
                    
                    for (let dy = -2; dy <= 2; dy++) {
                        for (let dx = -2; dx <= 2; dx++) {
                            const neighborValue = result[(y + dy) * width + (x + dx)];
                            if (neighborValue > 128) foregroundCount++;
                            totalCount++;
                        }
                    }
                    
                    // 如果周围超过 60% 是前景，则填充为前景
                    if (foregroundCount / totalCount > 0.6) {
                        result[idx] = 255;
                    }
                }
            }
        }
        
        // Pass 3: 边界平滑（3x3 高斯模糊仅对边界像素）
        const smoothed = Buffer.from(result);
        const gaussKernel = [1, 2, 1, 2, 4, 2, 1, 2, 1];
        const gaussSum = 16;
        
        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                const idx = y * width + x;
                
                // 检测是否是边界
                let hasFg = false, hasBg = false;
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        const nv = result[(y + dy) * width + (x + dx)];
                        if (nv > 200) hasFg = true;
                        if (nv < 50) hasBg = true;
                    }
                }
                
                if (hasFg && hasBg) {
                    let sum = 0, ki = 0;
                    for (let dy = -1; dy <= 1; dy++) {
                        for (let dx = -1; dx <= 1; dx++) {
                            sum += result[(y + dy) * width + (x + dx)] * gaussKernel[ki++];
                        }
                    }
                    smoothed[idx] = Math.round(sum / gaussSum);
                }
            }
        }
        
        return smoothed;
    }

    /**
     * 边缘平滑处理 - 对边缘区域应用高斯模糊
     * @deprecated 使用 refineMaskWithProbabilityThreshold 替代
     */
    private smoothMaskEdges(mask: Buffer, width: number, height: number): Buffer {
        const result = Buffer.alloc(width * height);
        
        // 3x3 高斯核 (sigma=1)
        const kernel = [
            1/16, 2/16, 1/16,
            2/16, 4/16, 2/16,
            1/16, 2/16, 1/16
        ];
        
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                const centerValue = mask[idx];
                
                // 检测是否是边缘区域（值在 30-225 之间，或相邻有显著差异）
                let isEdge = centerValue > 30 && centerValue < 225;
                
                if (!isEdge && (centerValue === 0 || centerValue === 255)) {
                    // 检查邻域是否有差异
                    for (let dy = -1; dy <= 1 && !isEdge; dy++) {
                        for (let dx = -1; dx <= 1 && !isEdge; dx++) {
                            const nx = x + dx;
                            const ny = y + dy;
                            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                                const neighborValue = mask[ny * width + nx];
                                if (Math.abs(neighborValue - centerValue) > 100) {
                                    isEdge = true;
                                }
                            }
                        }
                    }
                }
                
                if (isEdge) {
                    // 对边缘应用高斯模糊
                    let sum = 0;
                    let ki = 0;
                    
                    for (let dy = -1; dy <= 1; dy++) {
                        for (let dx = -1; dx <= 1; dx++) {
                            const nx = x + dx;
                            const ny = y + dy;
                            
                            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                                sum += mask[ny * width + nx] * kernel[ki];
                            } else {
                                sum += centerValue * kernel[ki];
                            }
                            ki++;
                        }
                    }
                    
                    result[idx] = Math.round(sum);
                } else {
                    // 非边缘区域保持原值
                    result[idx] = centerValue;
                }
            }
        }
        
        return result;
    }
    
    /**
     * 边缘硬化处理 - 将低不透明度像素设为 0，避免半透明背景残留
     * @param mask 输入蒙版
     * @param width 宽度
     * @param height 高度
     */
    private hardenMaskEdges(mask: Buffer, width: number, height: number): Buffer {
        const result = Buffer.alloc(width * height);
        
        // 阈值设置：低于此值的像素直接设为 0（完全透明）
        // 使用较高阈值（240）以彻底去除半透明边缘残留
        const lowThreshold = 240;
        // 高于此值的像素设为 255（完全不透明）
        const highThreshold = 250;
        
        for (let i = 0; i < mask.length; i++) {
            const value = mask[i];
            
            if (value < lowThreshold) {
                // 低不透明度：直接设为 0（去除背景残留）
                result[i] = 0;
            } else if (value >= highThreshold) {
                // 高不透明度：设为 255（确保前景完整）
                result[i] = 255;
            } else {
                // 中间值：线性映射到 0-255（保留少量过渡）
                // 将 [lowThreshold, highThreshold] 映射到 [0, 255]
                result[i] = Math.round((value - lowThreshold) / (highThreshold - lowThreshold) * 255);
            }
        }
        
        return result;
    }
    
    /**
     * 计算 Buffer 哈希（用于缓存键）
     */
    private hashBuffer(buffer: Buffer): string {
        const crypto = require('crypto');
        return crypto.createHash('md5').update(buffer).digest('hex');
    }
    
    /**
     * 启动缓存清理定时器
     */
    private startCacheCleanup(): void {
        setInterval(() => {
            const now = Date.now();
            for (const [key, value] of this.imageEmbeddingCache) {
                if (now - value.timestamp > this.CACHE_EXPIRY_MS) {
                    this.imageEmbeddingCache.delete(key);
                    console.log('[SAMService] 清理过期缓存');
                }
            }
        }, 60 * 1000);
    }
    
    /**
     * 获取 Encoder 模型路径
     */
    private getEncoderPath(): string {
        if (this.modelType === 'sam2_large') {
            return path.join(this.modelsDir, 'sam2', 'vision_encoder_fp16.onnx');
        }
        const modelName = this.modelType === 'mobile_sam' 
            ? 'mobile_sam_encoder.onnx'
            : 'sam_vit_b_encoder.onnx';
        return path.join(this.modelsDir, 'sam', modelName);
    }
    
    /**
     * 获取 Decoder 模型路径
     */
    private getDecoderPath(): string {
        if (this.modelType === 'sam2_large') {
            return path.join(this.modelsDir, 'sam2', 'prompt_encoder_mask_decoder_fp16.onnx');
        }
        const modelName = this.modelType === 'mobile_sam'
            ? 'mobile_sam_decoder.onnx'
            : 'sam_vit_b_decoder.onnx';
        return path.join(this.modelsDir, 'sam', modelName);
    }
    
    /**
     * 获取当前使用的模型类型
     */
    getModelType(): string {
        return this.modelType;
    }
    
    /**
     * 清理资源
     */
    async dispose(): Promise<void> {
        this.imageEmbeddingCache.clear();
        this.encoderSession = null;
        this.decoderSession = null;
        console.log('[SAMService] 资源已清理');
    }
}

// 单例
let samServiceInstance: SAMService | null = null;

export function getSAMService(config?: SAMConfig): SAMService {
    if (!samServiceInstance) {
        samServiceInstance = new SAMService(config);
    }
    return samServiceInstance;
}
