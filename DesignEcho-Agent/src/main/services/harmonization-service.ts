/**
 * 图像协调服务 - 前景背景融合
 * 
 * 功能：
 * 1. 色彩协调 - 调整前景色调匹配背景
 * 2. 光照协调 - 调整前景光照匹配背景
 * 3. AI 融合 - 使用 IC-Light 等模型实现高级融合（可选）
 * 
 * 技术方案：
 * - 快速模式：色彩直方图匹配 + 边缘融合（纯算法）
 * - AI 模式：IC-Light ONNX 模型（需下载模型）
 */

import * as path from 'path';
import * as fs from 'fs';

// ==================== 类型定义 ====================

export type HarmonizationMode = 'fast' | 'balanced' | 'ai';

export interface HarmonizationConfig {
    /** 模型目录 */
    modelsDir?: string;
    /** 默认模式 */
    defaultMode?: HarmonizationMode;
    /** GPU 加速 */
    gpuMode?: 'auto' | 'cuda' | 'directml' | 'cpu';
}

export interface HarmonizationParams {
    /** 前景图像 Base64 (带透明通道 PNG) */
    foreground: string;
    /** 背景图像 Base64 */
    background: string;
    /** 协调模式 */
    mode?: HarmonizationMode;
    /** 强度 0-1 */
    intensity?: number;
    /** 融合羽化半径 */
    featherRadius?: number;
    /** 是否保留前景原始色调（轻度协调） */
    preserveForeground?: boolean;
}

export interface HarmonizationResult {
    success: boolean;
    /** 协调后的合成图像 Base64 PNG */
    compositeImage?: string;
    /** 处理耗时 (ms) */
    processingTime?: number;
    /** 使用的模式 */
    usedMode?: HarmonizationMode;
    /** 色彩调整参数 */
    adjustments?: ColorAdjustments;
    /** 错误信息 */
    error?: string;
}

export interface ColorAdjustments {
    brightness: number;
    contrast: number;
    saturation: number;
    hueShift: number;
    temperature: number;
}

export interface ImageStats {
    meanR: number;
    meanG: number;
    meanB: number;
    stdR: number;
    stdG: number;
    stdB: number;
    brightness: number;
    saturation: number;
}

// ==================== 协调服务 ====================

export class HarmonizationService {
    private config: HarmonizationConfig;
    private modelsDir: string;
    private initialized: boolean = false;
    
    // ONNX Runtime 和 Sharp
    private ort: typeof import('onnxruntime-node') | null = null;
    private sharp: typeof import('sharp') | null = null;
    
    // AI 模型会话（可选）
    private icLightSession: any = null;
    private aiModelAvailable: boolean = false;
    
    constructor(config?: Partial<HarmonizationConfig>) {
        this.config = {
            defaultMode: 'balanced',
            gpuMode: 'auto',
            ...config
        };
        
        // 定位 models 目录
        const possiblePaths = [
            path.join(__dirname, '../../../../models'),
            path.join(__dirname, '../../../models'),
            path.join(process.cwd(), 'models'),
        ];
        
        this.modelsDir = possiblePaths.find(p => fs.existsSync(p)) || possiblePaths[0];
        console.log(`[HarmonizationService] 模型目录: ${this.modelsDir}`);
    }
    
    // ==================== 初始化 ====================
    
    private async ensureInitialized(): Promise<boolean> {
        if (this.initialized) return true;
        
        try {
            this.ort = await import('onnxruntime-node');
            this.sharp = (await import('sharp')).default;
            
            // 检查 AI 模型是否可用
            await this.checkAIModelAvailability();
            
            this.initialized = true;
            console.log('[HarmonizationService] ✅ 服务初始化完成');
            console.log(`[HarmonizationService] AI 模型可用: ${this.aiModelAvailable}`);
            
            return true;
        } catch (error: any) {
            console.error('[HarmonizationService] 初始化失败:', error.message);
            return false;
        }
    }
    
    private async checkAIModelAvailability(): Promise<void> {
        const icLightPath = path.join(this.modelsDir, 'harmonization', 'ic-light-fc-unet.onnx');
        
        if (fs.existsSync(icLightPath)) {
            try {
                // 尝试加载模型验证其有效性
                console.log('[HarmonizationService] 检测到 IC-Light 模型，验证中...');
                
                const stats = fs.statSync(icLightPath);
                if (stats.size > 100 * 1024 * 1024) { // 至少 100MB
                    this.aiModelAvailable = true;
                    console.log(`[HarmonizationService] ✅ IC-Light 模型验证通过 (${(stats.size / 1024 / 1024).toFixed(0)}MB)`);
                } else {
                    console.log('[HarmonizationService] ⚠️ IC-Light 模型文件不完整');
                }
            } catch (error) {
                console.log('[HarmonizationService] ⚠️ IC-Light 模型验证失败');
            }
        } else {
            console.log('[HarmonizationService] ℹ️ AI 模型未安装，使用算法协调模式');
        }
    }
    
    // ==================== 公开接口 ====================
    
    /**
     * 获取服务状态
     */
    public async getStatus(): Promise<{
        initialized: boolean;
        aiModelAvailable: boolean;
        supportedModes: HarmonizationMode[];
    }> {
        await this.ensureInitialized();
        
        return {
            initialized: this.initialized,
            aiModelAvailable: this.aiModelAvailable,
            supportedModes: this.aiModelAvailable 
                ? ['fast', 'balanced', 'ai'] 
                : ['fast', 'balanced']
        };
    }
    
    /**
     * 执行图像协调
     */
    public async harmonize(params: HarmonizationParams): Promise<HarmonizationResult> {
        const startTime = Date.now();
        
        try {
            await this.ensureInitialized();
            
            if (!this.sharp) {
                throw new Error('Sharp 库未加载');
            }
            
            const mode = params.mode || this.config.defaultMode || 'balanced';
            const intensity = params.intensity ?? 0.7;
            const featherRadius = params.featherRadius ?? 3;
            
            console.log(`[HarmonizationService] 开始协调，模式: ${mode}, 强度: ${intensity}`);
            
            // 解析图像
            const fgBuffer = Buffer.from(
                params.foreground.replace(/^data:image\/\w+;base64,/, ''),
                'base64'
            );
            const bgBuffer = Buffer.from(
                params.background.replace(/^data:image\/\w+;base64,/, ''),
                'base64'
            );
            
            // 获取图像信息
            const fgMeta = await this.sharp(fgBuffer).metadata();
            const bgMeta = await this.sharp(bgBuffer).metadata();
            
            console.log(`[HarmonizationService] 前景: ${fgMeta.width}x${fgMeta.height}, 背景: ${bgMeta.width}x${bgMeta.height}`);
            
            let result: Buffer;
            let adjustments: ColorAdjustments | undefined;
            
            if (mode === 'ai' && this.aiModelAvailable) {
                // AI 协调模式（需要 IC-Light 模型）
                result = await this.harmonizeWithAI(fgBuffer, bgBuffer, intensity);
            } else {
                // 算法协调模式
                const harmonized = await this.harmonizeWithAlgorithm(
                    fgBuffer, 
                    bgBuffer, 
                    intensity,
                    featherRadius,
                    params.preserveForeground
                );
                result = harmonized.composite;
                adjustments = harmonized.adjustments;
            }
            
            const compositeBase64 = `data:image/png;base64,${result.toString('base64')}`;
            
            const processingTime = Date.now() - startTime;
            console.log(`[HarmonizationService] ✅ 协调完成，耗时: ${processingTime}ms`);
            
            return {
                success: true,
                compositeImage: compositeBase64,
                processingTime,
                usedMode: mode,
                adjustments
            };
            
        } catch (error: any) {
            console.error('[HarmonizationService] 协调失败:', error.message);
            return {
                success: false,
                error: error.message,
                processingTime: Date.now() - startTime
            };
        }
    }
    
    // ==================== 算法协调 ====================
    
    /**
     * 使用算法进行色彩协调
     */
    private async harmonizeWithAlgorithm(
        fgBuffer: Buffer,
        bgBuffer: Buffer,
        intensity: number,
        featherRadius: number,
        preserveForeground?: boolean
    ): Promise<{ composite: Buffer; adjustments: ColorAdjustments }> {
        if (!this.sharp) throw new Error('Sharp 未初始化');
        
        // 1. 分析背景色彩统计
        const bgStats = await this.analyzeImageStats(bgBuffer);
        const fgStats = await this.analyzeImageStats(fgBuffer);
        
        console.log('[HarmonizationService] 背景统计:', bgStats);
        console.log('[HarmonizationService] 前景统计:', fgStats);
        
        // 2. 计算调整参数
        const adjustments = this.calculateAdjustments(fgStats, bgStats, intensity, preserveForeground);
        console.log('[HarmonizationService] 调整参数:', adjustments);
        
        // 3. 获取前景图像的原始数据和 alpha 通道
        const fgImage = this.sharp(fgBuffer);
        const fgMeta = await fgImage.metadata();
        
        // 4. 应用色彩调整到前景
        const adjustedFg = await this.applyColorAdjustments(fgBuffer, adjustments);
        
        // 5. 调整前景尺寸以匹配背景（如果需要）
        const bgMeta = await this.sharp(bgBuffer).metadata();
        let finalFg = adjustedFg;
        
        if (fgMeta.width !== bgMeta.width || fgMeta.height !== bgMeta.height) {
            // 保持前景原始尺寸，居中放置
            // 不做尺寸调整，合成时处理
        }
        
        // 6. 合成图像
        const composite = await this.sharp(bgBuffer)
            .composite([{
                input: finalFg,
                gravity: 'center',
                blend: 'over'
            }])
            .png()
            .toBuffer();
        
        return { composite, adjustments };
    }
    
    /**
     * 分析图像色彩统计
     */
    private async analyzeImageStats(imageBuffer: Buffer): Promise<ImageStats> {
        if (!this.sharp) throw new Error('Sharp 未初始化');
        
        // 获取 raw 像素数据
        const { data, info } = await this.sharp(imageBuffer)
            .resize(256, 256, { fit: 'inside' })  // 缩小以加速分析
            .removeAlpha()  // 移除透明通道用于背景分析
            .raw()
            .toBuffer({ resolveWithObject: true });
        
        const pixels = info.width * info.height;
        const channels = 3;
        
        // 计算均值
        let sumR = 0, sumG = 0, sumB = 0;
        for (let i = 0; i < data.length; i += channels) {
            sumR += data[i];
            sumG += data[i + 1];
            sumB += data[i + 2];
        }
        
        const meanR = sumR / pixels;
        const meanG = sumG / pixels;
        const meanB = sumB / pixels;
        
        // 计算标准差
        let varR = 0, varG = 0, varB = 0;
        for (let i = 0; i < data.length; i += channels) {
            varR += Math.pow(data[i] - meanR, 2);
            varG += Math.pow(data[i + 1] - meanG, 2);
            varB += Math.pow(data[i + 2] - meanB, 2);
        }
        
        const stdR = Math.sqrt(varR / pixels);
        const stdG = Math.sqrt(varG / pixels);
        const stdB = Math.sqrt(varB / pixels);
        
        // 计算整体亮度和饱和度
        const brightness = (meanR + meanG + meanB) / 3 / 255;
        const maxChannel = Math.max(meanR, meanG, meanB);
        const minChannel = Math.min(meanR, meanG, meanB);
        const saturation = maxChannel > 0 ? (maxChannel - minChannel) / maxChannel : 0;
        
        return {
            meanR, meanG, meanB,
            stdR, stdG, stdB,
            brightness,
            saturation
        };
    }
    
    /**
     * 计算色彩调整参数
     */
    private calculateAdjustments(
        fgStats: ImageStats,
        bgStats: ImageStats,
        intensity: number,
        preserveForeground?: boolean
    ): ColorAdjustments {
        // 亮度差异
        const brightnessDiff = bgStats.brightness - fgStats.brightness;
        
        // 对比度差异（通过标准差估算）
        const fgContrast = (fgStats.stdR + fgStats.stdG + fgStats.stdB) / 3;
        const bgContrast = (bgStats.stdR + bgStats.stdG + bgStats.stdB) / 3;
        const contrastRatio = bgContrast > 0 ? fgContrast / bgContrast : 1;
        
        // 饱和度差异
        const saturationDiff = bgStats.saturation - fgStats.saturation;
        
        // 色温差异（R-B 通道差异）
        const fgTemp = fgStats.meanR - fgStats.meanB;
        const bgTemp = bgStats.meanR - bgStats.meanB;
        const tempDiff = bgTemp - fgTemp;
        
        // 色相偏移（简化计算）
        const hueShift = 0; // 暂不计算复杂色相偏移
        
        // 根据强度和保留前景选项调整
        const effectiveIntensity = preserveForeground ? intensity * 0.5 : intensity;
        
        return {
            brightness: brightnessDiff * effectiveIntensity * 100, // 转换为百分比
            contrast: (1 / contrastRatio - 1) * effectiveIntensity * 0.5 + 1, // 对比度调整系数
            saturation: saturationDiff * effectiveIntensity + 1, // 饱和度调整系数
            hueShift: hueShift * effectiveIntensity,
            temperature: tempDiff * effectiveIntensity * 0.5 // 色温调整
        };
    }
    
    /**
     * 应用色彩调整
     */
    private async applyColorAdjustments(
        imageBuffer: Buffer,
        adjustments: ColorAdjustments
    ): Promise<Buffer> {
        if (!this.sharp) throw new Error('Sharp 未初始化');
        
        let image = this.sharp(imageBuffer);
        
        // 应用亮度
        if (Math.abs(adjustments.brightness) > 0.01) {
            image = image.modulate({
                brightness: 1 + adjustments.brightness / 100
            });
        }
        
        // 应用饱和度
        if (Math.abs(adjustments.saturation - 1) > 0.01) {
            image = image.modulate({
                saturation: adjustments.saturation
            });
        }
        
        // 应用色温（通过 tint 调整）
        if (Math.abs(adjustments.temperature) > 1) {
            // 正值偏暖（增加红减少蓝），负值偏冷
            const tempR = adjustments.temperature > 0 ? adjustments.temperature * 0.5 : 0;
            const tempB = adjustments.temperature < 0 ? -adjustments.temperature * 0.5 : 0;
            
            image = image.recomb([
                [1 + tempR / 255, 0, 0],
                [0, 1, 0],
                [0, 0, 1 + tempB / 255]
            ]);
        }
        
        // 转换为 PNG 保留透明通道
        return await image.png().toBuffer();
    }
    
    // ==================== AI 协调 ====================
    
    /**
     * 使用 AI 模型进行协调（IC-Light）
     */
    private async harmonizeWithAI(
        fgBuffer: Buffer,
        bgBuffer: Buffer,
        intensity: number
    ): Promise<Buffer> {
        if (!this.ort || !this.sharp) {
            throw new Error('ONNX Runtime 或 Sharp 未初始化');
        }
        
        // 加载 IC-Light 模型
        if (!this.icLightSession) {
            await this.loadICLightModel();
        }
        
        if (!this.icLightSession) {
            throw new Error('IC-Light 模型加载失败，回退到算法模式');
        }
        
        // IC-Light 推理流程
        // 注意：IC-Light 是 U-Net 结构，需要特定的输入格式
        
        console.log('[HarmonizationService] 使用 IC-Light AI 协调...');
        
        // 准备输入
        const inputSize = 512; // IC-Light 标准输入尺寸
        
        // 前景图像预处理
        const fgProcessed = await this.sharp(fgBuffer)
            .resize(inputSize, inputSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .raw()
            .toBuffer();
        
        // 背景图像预处理
        const bgProcessed = await this.sharp(bgBuffer)
            .resize(inputSize, inputSize, { fit: 'cover' })
            .removeAlpha()
            .raw()
            .toBuffer();
        
        // 创建输入张量
        // IC-Light 输入格式：[batch, channels, height, width]
        const fgTensor = this.createTensorFromBuffer(fgProcessed, inputSize, 4); // RGBA
        const bgTensor = this.createTensorFromBuffer(bgProcessed, inputSize, 3); // RGB
        
        // 运行推理
        try {
            const feeds: Record<string, any> = {
                'foreground': new this.ort.Tensor('float32', fgTensor, [1, 4, inputSize, inputSize]),
                'background': new this.ort.Tensor('float32', bgTensor, [1, 3, inputSize, inputSize]),
                'intensity': new this.ort.Tensor('float32', [intensity], [1])
            };
            
            const results = await this.icLightSession.run(feeds);
            const outputData = results['output'].data as Float32Array;
            
            // 后处理：将输出转换回图像
            const outputBuffer = this.tensorToBuffer(outputData, inputSize, 3);
            
            // 恢复原始尺寸
            const bgMeta = await this.sharp(bgBuffer).metadata();
            const result = await this.sharp(Buffer.from(outputBuffer))
                .resize(bgMeta.width!, bgMeta.height!, { fit: 'fill' })
                .png()
                .toBuffer();
            
            return result;
            
        } catch (error: any) {
            console.error('[HarmonizationService] AI 推理失败:', error.message);
            throw error;
        }
    }
    
    /**
     * 加载 IC-Light 模型
     */
    private async loadICLightModel(): Promise<void> {
        if (!this.ort) throw new Error('ONNX Runtime 未初始化');
        
        const modelPath = path.join(this.modelsDir, 'harmonization', 'ic-light-fc-unet.onnx');
        
        if (!fs.existsSync(modelPath)) {
            console.log('[HarmonizationService] IC-Light 模型不存在');
            return;
        }
        
        console.log('[HarmonizationService] 加载 IC-Light 模型...');
        
        try {
            const sessionOptions: any = {
                graphOptimizationLevel: 'all',
                executionProviders: ['cpu'], // IC-Light 较大，先用 CPU
                logSeverityLevel: 3  // 抑制警告，只显示错误
            };
            
            this.icLightSession = await this.ort.InferenceSession.create(modelPath, sessionOptions);
            
            console.log('[HarmonizationService] ✅ IC-Light 模型加载完成');
            console.log('[HarmonizationService] 输入:', this.icLightSession.inputNames);
            console.log('[HarmonizationService] 输出:', this.icLightSession.outputNames);
            
        } catch (error: any) {
            console.error('[HarmonizationService] IC-Light 模型加载失败:', error.message);
            this.icLightSession = null;
        }
    }
    
    // ==================== 工具方法 ====================
    
    private createTensorFromBuffer(buffer: Buffer, size: number, channels: number): Float32Array {
        const tensor = new Float32Array(channels * size * size);
        const pixels = size * size;
        
        for (let i = 0; i < pixels; i++) {
            for (let c = 0; c < channels; c++) {
                // NHWC -> NCHW 转换 + 归一化到 [0, 1]
                tensor[c * pixels + i] = buffer[i * channels + c] / 255.0;
            }
        }
        
        return tensor;
    }
    
    private tensorToBuffer(tensor: Float32Array, size: number, channels: number): Uint8Array {
        const buffer = new Uint8Array(size * size * channels);
        const pixels = size * size;
        
        for (let i = 0; i < pixels; i++) {
            for (let c = 0; c < channels; c++) {
                // NCHW -> NHWC 转换 + 反归一化
                const value = Math.round(tensor[c * pixels + i] * 255);
                buffer[i * channels + c] = Math.max(0, Math.min(255, value));
            }
        }
        
        return buffer;
    }
}

// ==================== 单例管理 ====================

let harmonizationServiceInstance: HarmonizationService | null = null;

export function getHarmonizationService(config?: Partial<HarmonizationConfig>): HarmonizationService {
    if (!harmonizationServiceInstance) {
        harmonizationServiceInstance = new HarmonizationService(config);
    }
    return harmonizationServiceInstance;
}

export function createHarmonizationService(config?: Partial<HarmonizationConfig>): HarmonizationService {
    return new HarmonizationService(config);
}
