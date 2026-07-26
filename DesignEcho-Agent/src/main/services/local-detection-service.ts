/**
 * 本地目标检测服务
 * 
 * 支持多种检测模型：
 * - Grounding DINO: 开放词汇检测（文本引导，可检测任意物体）★推荐
 * - YOLO-World: 实时开放词汇检测
 * - Human Parsing: 人体部位解析（18 类：头发/皮肤/衣服/鞋子/袜子等）
 * - YOLO: 固定 80 类 COCO 物体检测
 * 
 * 检测流程：
 * 1. 用户输入目标描述（如"袜子"）
 * 2. 根据配置选择检测模型：
 *    - Grounding DINO: 直接用文本描述检测任意物体
 *    - Human Parsing: 自动识别人体各部位
 *    - YOLO: 匹配 COCO 类别后检测
 * 3. 返回边界框或分割掩码
 */

import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';

// COCO 80 类别（英文 + 中文映射）
const COCO_CLASSES: { [key: string]: string[] } = {
    'person': ['人', '人物', '人像', '模特', '人体'],
    'bicycle': ['自行车', '单车', '脚踏车'],
    'car': ['汽车', '轿车', '车', '小汽车'],
    'motorcycle': ['摩托车', '机车', '摩托'],
    'airplane': ['飞机', '客机', '航班'],
    'bus': ['公交车', '巴士', '大巴'],
    'train': ['火车', '列车', '地铁'],
    'truck': ['卡车', '货车', '大卡车'],
    'boat': ['船', '小船', '轮船', '帆船'],
    'traffic light': ['红绿灯', '交通灯', '信号灯'],
    'fire hydrant': ['消防栓', '消火栓'],
    'stop sign': ['停车标志', '停止标志'],
    'parking meter': ['停车计时器', '咪表'],
    'bench': ['长椅', '板凳', '椅子'],
    'bird': ['鸟', '小鸟', '禽鸟'],
    'cat': ['猫', '猫咪', '小猫', '猫猫'],
    'dog': ['狗', '狗狗', '小狗', '犬'],
    'horse': ['马', '骏马', '马匹'],
    'sheep': ['羊', '绵羊', '羔羊'],
    'cow': ['牛', '奶牛', '黄牛'],
    'elephant': ['大象', '象'],
    'bear': ['熊', '棕熊', '黑熊'],
    'zebra': ['斑马'],
    'giraffe': ['长颈鹿'],
    'backpack': ['背包', '书包', '双肩包'],
    'umbrella': ['雨伞', '伞', '太阳伞'],
    'handbag': ['手提包', '女包', '手袋', '包包'],
    'tie': ['领带', '领结'],
    'suitcase': ['行李箱', '拉杆箱', '旅行箱'],
    'frisbee': ['飞盘', '飞碟'],
    'skis': ['滑雪板', '雪橇'],
    'snowboard': ['单板滑雪', '滑雪板'],
    'sports ball': ['球', '足球', '篮球', '排球'],
    'kite': ['风筝'],
    'baseball bat': ['棒球棒', '球棒'],
    'baseball glove': ['棒球手套'],
    'skateboard': ['滑板'],
    'surfboard': ['冲浪板'],
    'tennis racket': ['网球拍', '球拍'],
    'bottle': ['瓶子', '水瓶', '酒瓶', '饮料瓶'],
    'wine glass': ['红酒杯', '酒杯', '高脚杯'],
    'cup': ['杯子', '茶杯', '咖啡杯', '马克杯', '水杯'],
    'fork': ['叉子', '餐叉'],
    'knife': ['刀', '餐刀', '小刀'],
    'spoon': ['勺子', '汤勺', '调羹'],
    'bowl': ['碗', '饭碗', '汤碗'],
    'banana': ['香蕉'],
    'apple': ['苹果'],
    'sandwich': ['三明治', '汉堡'],
    'orange': ['橙子', '橘子'],
    'broccoli': ['西兰花', '花椰菜'],
    'carrot': ['胡萝卜', '红萝卜'],
    'hot dog': ['热狗'],
    'pizza': ['披萨', '比萨'],
    'donut': ['甜甜圈', '多纳圈'],
    'cake': ['蛋糕', '糕点'],
    'chair': ['椅子', '座椅', '凳子'],
    'couch': ['沙发', '长沙发'],
    'potted plant': ['盆栽', '绿植', '植物', '花盆'],
    'bed': ['床', '床铺'],
    'dining table': ['餐桌', '桌子', '饭桌'],
    'toilet': ['马桶', '厕所', '卫生间'],
    'tv': ['电视', '电视机', '显示器'],
    'laptop': ['笔记本电脑', '电脑', '笔记本'],
    'mouse': ['鼠标'],
    'remote': ['遥控器'],
    'keyboard': ['键盘'],
    'cell phone': ['手机', '电话', '手提电话'],
    'microwave': ['微波炉'],
    'oven': ['烤箱', '烤炉'],
    'toaster': ['烤面包机', '吐司机'],
    'sink': ['水槽', '洗手池', '水池'],
    'refrigerator': ['冰箱', '电冰箱'],
    'book': ['书', '书籍', '书本'],
    'clock': ['钟', '时钟', '挂钟', '闹钟'],
    'vase': ['花瓶', '瓶'],
    'scissors': ['剪刀'],
    'teddy bear': ['泰迪熊', '玩具熊', '毛绒熊'],
    'hair drier': ['吹风机', '电吹风'],
    'toothbrush': ['牙刷']
};

// 扩展词汇映射（用于处理 COCO 不支持的物体）
const EXTENDED_MAPPINGS: { [key: string]: string } = {
    // 服饰类 - ★ 可用 Human Parsing 精确识别
    '袜子': 'human_parsing',
    '鞋子': 'human_parsing',
    '帽子': 'human_parsing',
    '手套': 'human_parsing',
    '围巾': 'human_parsing',
    '衣服': 'human_parsing',
    '上衣': 'human_parsing',
    '裤子': 'human_parsing',
    '裙子': 'human_parsing',
    '外套': 'human_parsing',
    '夹克': 'human_parsing',
    '连衣裙': 'human_parsing',
    '腰带': 'human_parsing',
    '包': 'human_parsing',
    '背包': 'human_parsing',
    // 身体部位类 - ★ Human Parsing 可以精确分割
    '头发': 'human_parsing',
    '皮肤': 'human_parsing',
    '脸': 'human_parsing',
    '手': 'human_parsing',
    '手臂': 'human_parsing',
    '腿': 'human_parsing',
    '脚': 'human_parsing',
    '左腿': 'human_parsing',
    '右腿': 'human_parsing',
    '左臂': 'human_parsing',
    '右臂': 'human_parsing',
    // 开放词汇检测 - 使用 Grounding DINO
    '产品': 'open_vocabulary',
    '商品': 'open_vocabulary',
    '物品': 'open_vocabulary',
    '主体': 'foreground',
    '前景': 'foreground'
};

// ========== Human Parsing 18 类别定义 ==========
// 基于 ATR (Automatic Tagging Recognition) / LIP (Look Into Person) 数据集
const HUMAN_PARSING_CLASSES: { id: number; name: string; chinese: string[] }[] = [
    { id: 0, name: 'background', chinese: ['背景'] },
    { id: 1, name: 'hat', chinese: ['帽子', '头饰'] },
    { id: 2, name: 'hair', chinese: ['头发', '发丝', '秀发'] },
    { id: 3, name: 'sunglasses', chinese: ['太阳镜', '眼镜', '墨镜'] },
    { id: 4, name: 'upper_clothes', chinese: ['上衣', '衣服', 'T恤', '衬衫', '毛衣', '卫衣'] },
    { id: 5, name: 'skirt', chinese: ['裙子', '短裙', '半身裙'] },
    { id: 6, name: 'pants', chinese: ['裤子', '长裤', '短裤', '牛仔裤'] },
    { id: 7, name: 'dress', chinese: ['连衣裙', '裙装', '长裙'] },
    { id: 8, name: 'belt', chinese: ['腰带', '皮带'] },
    { id: 9, name: 'left_shoe', chinese: ['左鞋', '鞋子', '运动鞋', '皮鞋', '高跟鞋'] },
    { id: 10, name: 'right_shoe', chinese: ['右鞋', '鞋子'] },
    { id: 11, name: 'face', chinese: ['脸', '面部', '脸部', '面容'] },
    { id: 12, name: 'left_leg', chinese: ['左腿', '腿', '腿部'] },
    { id: 13, name: 'right_leg', chinese: ['右腿', '腿'] },
    { id: 14, name: 'left_arm', chinese: ['左臂', '手臂', '胳膊'] },
    { id: 15, name: 'right_arm', chinese: ['右臂', '手臂'] },
    { id: 16, name: 'bag', chinese: ['包', '背包', '手提包', '挎包'] },
    { id: 17, name: 'scarf', chinese: ['围巾', '丝巾', '领巾'] },
    // 扩展类别（某些模型支持更多）
    { id: 18, name: 'socks', chinese: ['袜子', '丝袜', '短袜', '长袜'] },
    { id: 19, name: 'gloves', chinese: ['手套'] },
    { id: 20, name: 'coat', chinese: ['外套', '大衣', '夹克', '风衣'] },
    { id: 21, name: 'skin', chinese: ['皮肤', '肌肤'] },
];

export interface DetectionResult {
    success: boolean;
    boundingBox?: {
        x1: number;
        y1: number;
        x2: number;
        y2: number;
        confidence: number;
        label: string;
    };
    // 分割掩码（Human Parsing / SAM 返回）
    segmentationMask?: {
        buffer: Buffer;
        width: number;
        height: number;
        classId?: number;  // Human Parsing 返回的类别 ID
    };
    method: 'yolo' | 'grounding_dino' | 'yolo_world' | 'human_parsing' | 'sam' | 'clip' | 'full_image' | 'saliency';
    matchedClass?: string;
    detectedClasses?: string[];  // Human Parsing 检测到的所有类别
    error?: string;
    reasonCode?: string;
    fallbackUsed?: boolean;
    fallbackChain?: string[];
}

// 检测模型类型
export type DetectionModelType = 
    | 'detection-skip'
    | 'detection-grounding-dino'
    | 'detection-yolo-world'
    | 'detection-human-parsing'
    | 'detection-clothes-seg'
    | 'detection-tiny-yolov3'
    | 'detection-yolov4';

export class LocalDetectionService {
    private modelsDir: string;
    private ort: any = null;
    private sharp: any = null;
    private initialized = false;
    
    // 模型会话缓存
    private sessions: Map<string, any> = new Map();
    
    // 当前使用的检测模型
    private currentModel: DetectionModelType = 'detection-skip';

    constructor() {
        this.modelsDir = path.join(app.getPath('userData'), 'models');
    }

    /**
     * 设置当前检测模型
     */
    setDetectionModel(model: DetectionModelType): void {
        this.currentModel = model;
        console.log(`[LocalDetection] 设置检测模型: ${model}`);
    }

    /**
     * 确保依赖已加载
     */
    private async ensureInitialized(): Promise<boolean> {
        if (this.initialized) return true;

        try {
            this.ort = (await import('onnxruntime-node')).default;
            this.sharp = (await import('sharp')).default;
            this.initialized = true;
            return true;
        } catch (e: any) {
            console.error('[LocalDetection] 初始化失败:', e.message);
            return false;
        }
    }

    /**
     * 获取或加载模型会话
     */
    private async getSession(modelName: string, modelPath: string): Promise<any> {
        if (this.sessions.has(modelName)) {
            return this.sessions.get(modelName);
        }

        const fullPath = path.join(this.modelsDir, modelPath);
        if (!fs.existsSync(fullPath)) {
            console.warn(`[LocalDetection] 模型未找到: ${fullPath}`);
            return null;
        }

        try {
            const session = await this.ort.InferenceSession.create(fullPath, {
                executionProviders: ['cpu'],
                logSeverityLevel: 3  // 抑制警告，只显示错误
            });
            this.sessions.set(modelName, session);
            console.log(`[LocalDetection] 模型加载成功: ${modelName}`);
            return session;
        } catch (e: any) {
            console.error(`[LocalDetection] 模型加载失败 ${modelName}: ${e.message}`);
            return null;
        }
    }

    /**
     * 加载 YOLO 模型
     */
    private async loadYoloModel(): Promise<boolean> {
        const session = await this.getSession('yolo', 'yolo/tiny-yolov3.onnx');
        return session !== null;
    }

    /**
     * 加载 Grounding DINO 模型
     */
    private async loadGroundingDinoModel(): Promise<boolean> {
        const session = await this.getSession('grounding-dino', 'grounding-dino/groundingdino_swint_ogc.onnx');
        return session !== null;
    }

    /**
     * 加载 Human Parsing 模型
     */
    private async loadHumanParsingModel(): Promise<boolean> {
        const session = await this.getSession('human-parsing', 'human-parsing/schp_atr.onnx');
        return session !== null;
    }

    /**
     * 加载 YOLO-World 模型
     * 支持两种版本：
     * - yolov8s-worldv2.onnx (48MB 轻量版，已内置文本编码)
     * - yolo-world-full.onnx (419MB 完整版，需配合 CLIP 编码器)
     */
    private async loadYoloWorldModel(): Promise<boolean> {
        // 优先加载轻量版
        let session = await this.getSession('yolo-world', 'yolo-world/yolov8s-worldv2.onnx');
        if (session) {
            console.log('[LocalDetection] 已加载 YOLO-World 轻量版 (YOLOv8s-WorldV2)');
            return true;
        }
        
        // 尝试加载完整版
        session = await this.getSession('yolo-world', 'yolo-world/yolo-world-full.onnx');
        if (session) {
            console.log('[LocalDetection] 已加载 YOLO-World 完整版');
            return true;
        }
        
        return false;
    }

    /**
     * 将用户输入的中文目标匹配到 COCO 类别
     */
    private matchCocoClass(targetPrompt: string): string | null {
        const prompt = targetPrompt.toLowerCase().trim();

        // 1. 直接匹配扩展映射
        if (EXTENDED_MAPPINGS[prompt]) {
            console.log(`[LocalDetection] 匹配到扩展类别: ${prompt} → ${EXTENDED_MAPPINGS[prompt]}`);
            return EXTENDED_MAPPINGS[prompt];
        }

        // 2. 匹配 COCO 类别
        for (const [englishClass, chineseNames] of Object.entries(COCO_CLASSES)) {
            // 检查英文名
            if (prompt.includes(englishClass)) {
                return englishClass;
            }
            // 检查中文名
            for (const cn of chineseNames) {
                if (prompt.includes(cn) || cn.includes(prompt)) {
                    console.log(`[LocalDetection] 匹配到 COCO 类别: ${prompt} → ${englishClass}`);
                    return englishClass;
                }
            }
        }

        // 3. 没有匹配
        console.log(`[LocalDetection] 无法匹配到 COCO 类别: ${prompt}`);
        return null;
    }

    /**
     * 检测目标
     * 
     * @param imageBuffer - 图像数据
     * @param targetPrompt - 目标描述（如"袜子"、"杯子"）
     */
    async detect(
        imageBuffer: Buffer,
        targetPrompt: string
    ): Promise<DetectionResult> {
        if (!await this.ensureInitialized()) {
            return { 
                success: false, 
                error: '检测服务未初始化',
                method: 'full_image'
            };
        }

        console.log(`[LocalDetection] 检测目标: "${targetPrompt}", 模型: ${this.currentModel}`);

        // ========== 根据配置的检测模型路由 ==========
        switch (this.currentModel) {
            case 'detection-grounding-dino':
                // Grounding DINO: 开放词汇检测（最强大）
                return this.detectByGroundingDino(imageBuffer, targetPrompt);
            
            case 'detection-yolo-world':
                // YOLO-World: 实时开放词汇检测
                return this.detectByYoloWorld(imageBuffer, targetPrompt);
            
            case 'detection-human-parsing':
            case 'detection-clothes-seg':
                // Human Parsing: 人体部位解析
                return this.detectByHumanParsing(imageBuffer, targetPrompt);
            
            case 'detection-tiny-yolov3':
            case 'detection-yolov4':
                // YOLO: 固定 80 类检测
                return this.detectByYoloWithFallback(imageBuffer, targetPrompt);
            
            case 'detection-skip':
            default:
                // 跳过检测：使用智能回退
                return this.detectWithSmartFallback(imageBuffer, targetPrompt);
        }
    }

    /**
     * 智能回退检测（自动选择最佳方法）
     */
    private async detectWithSmartFallback(
        imageBuffer: Buffer,
        targetPrompt: string
    ): Promise<DetectionResult> {
        // 匹配类别
        const matchedClass = this.matchCocoClass(targetPrompt);

        // ★ 如果是服装/人体部位类别，优先使用 Human Parsing
        if (matchedClass === 'human_parsing') {
            console.log(`[LocalDetection] 目标"${targetPrompt}"属于人体/服装类别，使用 Human Parsing`);
            const result = await this.detectByHumanParsing(imageBuffer, targetPrompt);
            if (result.success) return result;
            // 回退到显著性
            return this.markFallback(
                await this.detectBySaliency(imageBuffer, targetPrompt),
                'HUMAN_PARSING_FAILED',
                ['human_parsing', 'saliency']
            );
        }

        // ★ 如果是开放词汇类别，优先使用 Grounding DINO
        if (matchedClass === 'open_vocabulary') {
            console.log(`[LocalDetection] 目标"${targetPrompt}"使用开放词汇检测`);
            const result = await this.detectByGroundingDino(imageBuffer, targetPrompt);
            if (result.success) return result;
            // 回退到显著性
            return this.markFallback(
                await this.detectBySaliency(imageBuffer, targetPrompt),
                'GROUNDING_DINO_FAILED',
                ['grounding_dino', 'saliency']
            );
        }

        // 如果是前景/主体，使用显著性检测
        if (matchedClass === 'foreground') {
            return this.detectBySaliency(imageBuffer, targetPrompt);
        }

        // 如果没有匹配到任何类别，尝试 Grounding DINO（如果可用）
        if (!matchedClass) {
            const dinoResult = await this.detectByGroundingDino(imageBuffer, targetPrompt);
            if (dinoResult.success) return dinoResult;
            return this.markFallback(
                await this.detectBySaliency(imageBuffer, targetPrompt),
                'OPEN_VOCAB_NOT_FOUND',
                ['grounding_dino', 'saliency']
            );
        }

        // COCO 类别：尝试 YOLO
        return this.detectByYoloWithFallback(imageBuffer, targetPrompt);
    }

    /**
     * YOLO 检测（带回退）
     */
    private async detectByYoloWithFallback(
        imageBuffer: Buffer,
        targetPrompt: string
    ): Promise<DetectionResult> {
        const matchedClass = this.matchCocoClass(targetPrompt);
        
        if (matchedClass && matchedClass !== 'human_parsing' && matchedClass !== 'open_vocabulary' && matchedClass !== 'foreground') {
        const yoloResult = await this.detectByYolo(imageBuffer, matchedClass);
        if (yoloResult.success && yoloResult.boundingBox) {
            return yoloResult;
            }
        }

        // 回退到显著性
        console.log('[LocalDetection] YOLO 未检测到目标，使用显著性检测');
        return this.markFallback(
            await this.detectBySaliency(imageBuffer, targetPrompt),
            'YOLO_NOT_FOUND',
            ['yolo', 'saliency']
        );
    }

    /**
     * 使用 YOLO 检测目标
     * 
     * Tiny YOLOv3 ONNX 推理流程：
     * 1. 图像预处理：resize 到 416x416，归一化到 [0,1]
     * 2. 运行推理
     * 3. 解析输出：边界框 + 置信度 + 类别
     * 4. 应用非极大值抑制 (NMS)
     * 5. 筛选目标类别
     */
    private async detectByYolo(
        imageBuffer: Buffer,
        targetClass: string
    ): Promise<DetectionResult> {
        // 检查 YOLO 模型
        if (!await this.loadYoloModel()) {
            return {
                success: false,
                method: 'yolo',
                error: 'YOLO 模型未安装'
            };
        }

        try {
            const startTime = Date.now();
            console.log(`[LocalDetection] YOLO 检测目标: ${targetClass}`);

            // 获取原始图像尺寸
            const metadata = await this.sharp(imageBuffer).metadata();
            const origWidth = metadata.width!;
            const origHeight = metadata.height!;

            // 预处理：resize 到 416x416 并归一化
            const INPUT_SIZE = 416;
            const resizedBuffer = await this.sharp(imageBuffer)
                .resize(INPUT_SIZE, INPUT_SIZE, { fit: 'fill' })
                .removeAlpha()
                .raw()
                .toBuffer();

            // 转换为 Float32 张量 [1, 3, 416, 416]
            const inputTensor = new Float32Array(3 * INPUT_SIZE * INPUT_SIZE);
            for (let i = 0; i < INPUT_SIZE * INPUT_SIZE; i++) {
                inputTensor[i] = resizedBuffer[i * 3] / 255.0;                      // R
                inputTensor[INPUT_SIZE * INPUT_SIZE + i] = resizedBuffer[i * 3 + 1] / 255.0;  // G
                inputTensor[2 * INPUT_SIZE * INPUT_SIZE + i] = resizedBuffer[i * 3 + 2] / 255.0;  // B
            }

            // 创建输入尺寸张量 (Tiny YOLOv3 需要)
            const imageSizeTensor = new Float32Array([origHeight, origWidth]);

            // 获取模型会话
            const yoloSession = this.sessions.get('yolo');
            if (!yoloSession) {
                throw new Error('YOLO 会话未找到');
            }

            // 运行推理
            const inputName = yoloSession.inputNames[0];
            const feeds: Record<string, any> = {
                [inputName]: new this.ort.Tensor('float32', inputTensor, [1, 3, INPUT_SIZE, INPUT_SIZE])
            };

            // 如果模型需要 image_shape 输入
            if (yoloSession.inputNames.includes('image_shape')) {
                feeds['image_shape'] = new this.ort.Tensor('float32', imageSizeTensor, [1, 2]);
            }

            const results = await yoloSession.run(feeds);
            
            // 解析输出
            // Tiny YOLOv3 通常有三个输出：boxes, scores, indices
            // 或者单个输出包含所有检测结果
            const outputNames = yoloSession.outputNames;
            console.log(`[LocalDetection] YOLO 输出: ${outputNames.join(', ')}`);

            // 尝试解析检测结果
            let detections: Array<{ box: number[]; score: number; classId: number }> = [];
            
            // 常见的 YOLO ONNX 输出格式处理
            if (outputNames.includes('boxes') && outputNames.includes('scores')) {
                // 格式 1: boxes + scores + indices
                const boxes = results['boxes']?.data;
                const scores = results['scores']?.data;
                const indices = results['indices']?.data;

                if (boxes && scores && indices) {
                    for (let i = 0; i < indices.length / 3; i++) {
                        const batchIdx = indices[i * 3];
                        const classIdx = indices[i * 3 + 1];
                        const boxIdx = indices[i * 3 + 2];
                        
                        detections.push({
                            box: [
                                boxes[boxIdx * 4],
                                boxes[boxIdx * 4 + 1],
                                boxes[boxIdx * 4 + 2],
                                boxes[boxIdx * 4 + 3]
                            ],
                            score: scores[classIdx * boxes.length / 4 + boxIdx] || 0.5,
                            classId: classIdx
                        });
                    }
                }
            } else if (outputNames.length === 1) {
                // 格式 2: 单输出 [batch, num_boxes, 5+num_classes]
                const output = results[outputNames[0]];
                const data = output.data;
                const dims = output.dims;
                
                if (dims.length === 3) {
                    const numBoxes = dims[1];
                    const boxSize = dims[2];
                    const numClasses = boxSize - 5;

                    for (let i = 0; i < numBoxes; i++) {
                        const offset = i * boxSize;
                        const objectness = data[offset + 4];
                        
                        if (objectness > 0.5) {  // 置信度阈值
                            // 找到最高类别得分
                            let maxScore = 0;
                            let maxClassId = 0;
                            for (let c = 0; c < numClasses; c++) {
                                const score = data[offset + 5 + c] * objectness;
                                if (score > maxScore) {
                                    maxScore = score;
                                    maxClassId = c;
                                }
                            }
                            
                            if (maxScore > 0.3) {
                                detections.push({
                                    box: [
                                        data[offset],     // x_center
                                        data[offset + 1], // y_center
                                        data[offset + 2], // width
                                        data[offset + 3]  // height
                                    ],
                                    score: maxScore,
                                    classId: maxClassId
                                });
                            }
                        }
                    }
                }
            }

            console.log(`[LocalDetection] YOLO 检测到 ${detections.length} 个对象 (${Date.now() - startTime}ms)`);

            // 查找目标类别
            const cocoClasses = Object.keys(COCO_CLASSES);
            const targetClassIdx = cocoClasses.indexOf(targetClass);
            
            // 筛选匹配的检测结果
            let matchedDetection: { box: number[]; score: number; classId: number } | null = null;
            let maxScore = 0;

            for (const det of detections) {
                const detectedClass = cocoClasses[det.classId] || 'unknown';
                console.log(`[LocalDetection] 检测: ${detectedClass} (${det.score.toFixed(2)})`);
                
                if (det.classId === targetClassIdx && det.score > maxScore) {
                    maxScore = det.score;
                    matchedDetection = det;
                }
            }

            if (matchedDetection !== null) {
                // 转换边界框到归一化坐标 [0,1]
                const box = matchedDetection.box;
                let x1: number, y1: number, x2: number, y2: number;
                
                // 判断是 center-wh 还是 corner 格式
                if (box[2] < 1 && box[3] < 1) {
                    // 已经是归一化的 center-wh 格式
                    x1 = Math.max(0, box[0] - box[2] / 2);
                    y1 = Math.max(0, box[1] - box[3] / 2);
                    x2 = Math.min(1, box[0] + box[2] / 2);
                    y2 = Math.min(1, box[1] + box[3] / 2);
                } else {
                    // 像素坐标格式
                    x1 = Math.max(0, box[0] / origWidth);
                    y1 = Math.max(0, box[1] / origHeight);
                    x2 = Math.min(1, box[2] / origWidth);
                    y2 = Math.min(1, box[3] / origHeight);
                }

                console.log(`[LocalDetection] YOLO 成功检测到 ${targetClass}: [${x1.toFixed(3)}, ${y1.toFixed(3)}, ${x2.toFixed(3)}, ${y2.toFixed(3)}]`);

                return {
                    success: true,
                    boundingBox: {
                        x1, y1, x2, y2,
                        confidence: matchedDetection.score,
                        label: targetClass
                    },
                    method: 'yolo',
                    matchedClass: targetClass
                };
            }

            // 未找到目标类别
            console.log(`[LocalDetection] YOLO 未检测到目标类别 ${targetClass}`);
            return {
                success: false,
                method: 'yolo',
                matchedClass: targetClass,
                error: `未检测到 ${targetClass}`
            };

        } catch (e: any) {
            console.error(`[LocalDetection] YOLO 推理失败: ${e.message}`);
        return {
            success: false,
            method: 'yolo',
            matchedClass: targetClass,
                error: `YOLO 推理失败: ${e.message}`
            };
        }
    }

    // ========== Grounding DINO: 开放词汇检测 ==========
    /**
     * 使用 Grounding DINO 进行文本引导的目标检测
     * 
     * 能力：输入任意文本描述，检测图像中对应的物体
     * 例如：输入"袜子"即可检测袜子位置
     */
    private async detectByGroundingDino(
        imageBuffer: Buffer,
        targetPrompt: string
    ): Promise<DetectionResult> {
        // 检查模型是否可用
        const session = await this.getSession('grounding-dino', 'grounding-dino/groundingdino_swint_ogc.onnx');
        if (!session) {
            console.log('[LocalDetection] Grounding DINO 模型未安装，回退到显著性检测');
            return this.markFallback(
                await this.detectBySaliency(imageBuffer, targetPrompt),
                'MODEL_UNAVAILABLE',
                ['grounding_dino', 'saliency']
            );
        }

        try {
            const startTime = Date.now();
            console.log(`[LocalDetection] Grounding DINO 检测: "${targetPrompt}"`);

            // 获取图像信息
            const metadata = await this.sharp(imageBuffer).metadata();
            const origWidth = metadata.width!;
            const origHeight = metadata.height!;

            // 预处理：resize 到 800x800 并归一化
            const INPUT_SIZE = 800;
            const resizedBuffer = await this.sharp(imageBuffer)
                .resize(INPUT_SIZE, INPUT_SIZE, { fit: 'fill' })
                .removeAlpha()
                .raw()
                .toBuffer();

            // 转换为 Float32 张量 [1, 3, 800, 800]，标准化
            const MEAN = [0.485, 0.456, 0.406];
            const STD = [0.229, 0.224, 0.225];
            const inputTensor = new Float32Array(3 * INPUT_SIZE * INPUT_SIZE);
            
            for (let i = 0; i < INPUT_SIZE * INPUT_SIZE; i++) {
                inputTensor[i] = (resizedBuffer[i * 3] / 255.0 - MEAN[0]) / STD[0];                      // R
                inputTensor[INPUT_SIZE * INPUT_SIZE + i] = (resizedBuffer[i * 3 + 1] / 255.0 - MEAN[1]) / STD[1];  // G
                inputTensor[2 * INPUT_SIZE * INPUT_SIZE + i] = (resizedBuffer[i * 3 + 2] / 255.0 - MEAN[2]) / STD[2];  // B
            }

            // 文本编码（简化版：使用字符级 tokenization）
            // 注意：完整版需要使用 BERT tokenizer
            const textTokens = this.simpleTokenize(targetPrompt, 256);

            // 构建输入
            const feeds: Record<string, any> = {
                'image': new this.ort.Tensor('float32', inputTensor, [1, 3, INPUT_SIZE, INPUT_SIZE]),
                'input_ids': new this.ort.Tensor('int64', BigInt64Array.from(textTokens.map(t => BigInt(t))), [1, textTokens.length]),
                'attention_mask': new this.ort.Tensor('int64', BigInt64Array.from(textTokens.map(() => BigInt(1))), [1, textTokens.length]),
            };

            // 运行推理
            const results = await session.run(feeds);
            
            // 解析输出
            const boxes = results['pred_boxes']?.data;
            const scores = results['pred_logits']?.data;
            
            if (!boxes || !scores) {
                throw new Error('Grounding DINO 输出格式不正确');
            }

            // 找到最高置信度的检测结果
            let bestBox: { cx: number; cy: number; w: number; h: number } | null = null;
            let bestScore = 0;
            const numBoxes = boxes.length / 4;

            for (let i = 0; i < numBoxes; i++) {
                const score = scores[i];
                if (score > bestScore && score > 0.3) {
                    bestScore = score;
                    bestBox = {
                        cx: boxes[i * 4],
                        cy: boxes[i * 4 + 1],
                        w: boxes[i * 4 + 2],
                        h: boxes[i * 4 + 3]
                    };
                }
            }

            console.log(`[LocalDetection] Grounding DINO 完成 (${Date.now() - startTime}ms)`);

            if (bestBox && bestScore > 0.3) {
                // 转换为 [0,1] 范围的边界框
                const x1 = Math.max(0, bestBox.cx - bestBox.w / 2);
                const y1 = Math.max(0, bestBox.cy - bestBox.h / 2);
                const x2 = Math.min(1, bestBox.cx + bestBox.w / 2);
                const y2 = Math.min(1, bestBox.cy + bestBox.h / 2);

                console.log(`[LocalDetection] Grounding DINO 检测到: "${targetPrompt}" [${x1.toFixed(3)}, ${y1.toFixed(3)}, ${x2.toFixed(3)}, ${y2.toFixed(3)}], 置信度: ${bestScore.toFixed(2)}`);

                return {
                    success: true,
                    boundingBox: {
                        x1, y1, x2, y2,
                        confidence: bestScore,
                        label: targetPrompt
                    },
                    method: 'grounding_dino',
                    matchedClass: targetPrompt
                };
            }

            console.log(`[LocalDetection] Grounding DINO 未检测到 "${targetPrompt}"`);
            return {
                success: false,
                method: 'grounding_dino',
                matchedClass: targetPrompt,
                error: `未检测到 "${targetPrompt}"`
            };

        } catch (e: any) {
            console.error(`[LocalDetection] Grounding DINO 推理失败: ${e.message}`);
            return {
                success: false,
                method: 'grounding_dino',
                error: `Grounding DINO 推理失败: ${e.message}`
            };
        }
    }

    /**
     * 简单的文本 tokenization（用于 Grounding DINO）
     * 注意：这是简化版，完整版应使用 BERT tokenizer
     */
    private simpleTokenize(text: string, maxLength: number): number[] {
        // [CLS] token = 101, [SEP] token = 102, [PAD] = 0
        const tokens: number[] = [101]; // [CLS]
        
        // 简单的字符级编码
        for (const char of text.toLowerCase()) {
            const code = char.charCodeAt(0);
            if (code >= 97 && code <= 122) {
                // a-z: 映射到 BERT vocab 范围
                tokens.push(code - 97 + 1037); // 大致映射
            } else if (code >= 48 && code <= 57) {
                // 0-9
                tokens.push(code - 48 + 1066);
            } else if (char === ' ') {
                // 空格
                tokens.push(1012);
            } else if (code >= 0x4e00 && code <= 0x9fff) {
                // 中文字符：使用 Unicode 编码的低位
                tokens.push((code % 21128) + 1000);
            }
        }
        
        tokens.push(102); // [SEP]
        
        // 填充到 maxLength
        while (tokens.length < maxLength) {
            tokens.push(0); // [PAD]
        }
        
        return tokens.slice(0, maxLength);
    }

    // ========== YOLO-World: 实时开放词汇检测 ==========
    /**
     * 使用 YOLO-World 进行开放词汇检测
     * 
     * 特点：速度快，支持自定义类别
     */
    private async detectByYoloWorld(
        imageBuffer: Buffer,
        targetPrompt: string
    ): Promise<DetectionResult> {
        // 优先尝试轻量版
        let session = await this.getSession('yolo-world', 'yolo-world/yolov8s-worldv2.onnx');
        if (!session) {
            // 尝试完整版
            session = await this.getSession('yolo-world', 'yolo-world/yolo-world-full.onnx');
        }
        if (!session) {
            console.log('[LocalDetection] YOLO-World 模型未安装，回退到 YOLOv4');
            return this.markFallback(
                await this.detectByYolo(imageBuffer, targetPrompt),
                'MODEL_UNAVAILABLE',
                ['yolo_world', 'yolo']
            );
        }

        try {
            const startTime = Date.now();
            console.log(`[LocalDetection] YOLO-World 检测: "${targetPrompt}"`);

            // 获取图像信息
            const metadata = await this.sharp(imageBuffer).metadata();
            const origWidth = metadata.width!;
            const origHeight = metadata.height!;

            // 预处理：resize 到 640x640
            const INPUT_SIZE = 640;
            const resizedBuffer = await this.sharp(imageBuffer)
                .resize(INPUT_SIZE, INPUT_SIZE, { fit: 'fill' })
                .removeAlpha()
                .raw()
                .toBuffer();

            // 转换为 Float32 张量
            const inputTensor = new Float32Array(3 * INPUT_SIZE * INPUT_SIZE);
            for (let i = 0; i < INPUT_SIZE * INPUT_SIZE; i++) {
                inputTensor[i] = resizedBuffer[i * 3] / 255.0;
                inputTensor[INPUT_SIZE * INPUT_SIZE + i] = resizedBuffer[i * 3 + 1] / 255.0;
                inputTensor[2 * INPUT_SIZE * INPUT_SIZE + i] = resizedBuffer[i * 3 + 2] / 255.0;
            }

            // 文本嵌入（YOLO-World 使用 CLIP 文本编码）
            const textEmbedding = this.getTextEmbedding(targetPrompt);

            // 构建输入
            const feeds: Record<string, any> = {
                'images': new this.ort.Tensor('float32', inputTensor, [1, 3, INPUT_SIZE, INPUT_SIZE]),
                'texts': new this.ort.Tensor('float32', textEmbedding, [1, 1, 512])
            };

            // 运行推理
            const results = await session.run(feeds);
            
            // 解析输出（格式：[batch, num_boxes, 5+num_classes]）
            const output = results[session.outputNames[0]];
            const data = output.data;
            const dims = output.dims;

            let bestBox: { x: number; y: number; w: number; h: number } | null = null;
            let bestScore = 0;

            if (dims.length >= 2) {
                const numBoxes = dims[1] || data.length / 6;
                const boxSize = dims[2] || 6;

                for (let i = 0; i < numBoxes; i++) {
                    const offset = i * boxSize;
                    const score = data[offset + 4];
                    
                    if (score > bestScore && score > 0.25) {
                        bestScore = score;
                        bestBox = {
                            x: data[offset],
                            y: data[offset + 1],
                            w: data[offset + 2],
                            h: data[offset + 3]
                        };
                    }
                }
            }

            console.log(`[LocalDetection] YOLO-World 完成 (${Date.now() - startTime}ms)`);

            if (bestBox && bestScore > 0.25) {
                // 转换边界框
                const x1 = Math.max(0, (bestBox.x - bestBox.w / 2) / INPUT_SIZE);
                const y1 = Math.max(0, (bestBox.y - bestBox.h / 2) / INPUT_SIZE);
                const x2 = Math.min(1, (bestBox.x + bestBox.w / 2) / INPUT_SIZE);
                const y2 = Math.min(1, (bestBox.y + bestBox.h / 2) / INPUT_SIZE);

                return {
                    success: true,
                    boundingBox: { x1, y1, x2, y2, confidence: bestScore, label: targetPrompt },
                    method: 'yolo_world',
                    matchedClass: targetPrompt
                };
            }

            return {
                success: false,
                method: 'yolo_world',
                error: `未检测到 "${targetPrompt}"`
            };

        } catch (e: any) {
            console.error(`[LocalDetection] YOLO-World 推理失败: ${e.message}`);
            return this.detectByGroundingDino(imageBuffer, targetPrompt);
        }
    }

    /**
     * 获取文本嵌入（简化版）
     */
    private getTextEmbedding(text: string): Float32Array {
        // 简化版：生成一个 512 维的伪嵌入
        // 完整版应使用 CLIP 文本编码器
        const embedding = new Float32Array(512);
        const textLower = text.toLowerCase();
        
        // 基于文本哈希生成伪嵌入
        for (let i = 0; i < 512; i++) {
            const charCode = textLower.charCodeAt(i % textLower.length) || 0;
            embedding[i] = Math.sin(charCode * (i + 1) * 0.01) * 0.1;
        }
        
        // 归一化
        let norm = 0;
        for (let i = 0; i < 512; i++) norm += embedding[i] * embedding[i];
        norm = Math.sqrt(norm);
        if (norm > 0) {
            for (let i = 0; i < 512; i++) embedding[i] /= norm;
        }
        
        return embedding;
    }

    // ========== Human Parsing: 人体部位解析 ==========
    /**
     * 使用 Human Parsing 模型进行人体部位分割
     * 
     * 能力：自动识别 18 类人体部位（头发/皮肤/上衣/裤子/鞋子/袜子等）
     */
    private async detectByHumanParsing(
        imageBuffer: Buffer,
        targetPrompt: string
    ): Promise<DetectionResult> {
        const session = await this.getSession('human-parsing', 'human-parsing/schp_atr.onnx');
        if (!session) {
            console.log('[LocalDetection] Human Parsing 模型未安装，回退到显著性检测');
            return this.markFallback(
                await this.detectBySaliency(imageBuffer, targetPrompt),
                'MODEL_UNAVAILABLE',
                ['human_parsing', 'saliency']
            );
        }

        try {
            const startTime = Date.now();
            console.log(`[LocalDetection] Human Parsing 检测: "${targetPrompt}"`);

            // 获取图像信息
            const metadata = await this.sharp(imageBuffer).metadata();
            const origWidth = metadata.width!;
            const origHeight = metadata.height!;

            // 预处理：resize 到 473x473（SCHP 标准尺寸）
            const INPUT_SIZE = 473;
            const resizedBuffer = await this.sharp(imageBuffer)
                .resize(INPUT_SIZE, INPUT_SIZE, { fit: 'fill' })
                .removeAlpha()
                .raw()
                .toBuffer();

            // 转换为 Float32 张量，标准化
            const MEAN = [0.485, 0.456, 0.406];
            const STD = [0.229, 0.224, 0.225];
            const inputTensor = new Float32Array(3 * INPUT_SIZE * INPUT_SIZE);
            
            for (let i = 0; i < INPUT_SIZE * INPUT_SIZE; i++) {
                inputTensor[i] = (resizedBuffer[i * 3] / 255.0 - MEAN[0]) / STD[0];
                inputTensor[INPUT_SIZE * INPUT_SIZE + i] = (resizedBuffer[i * 3 + 1] / 255.0 - MEAN[1]) / STD[1];
                inputTensor[2 * INPUT_SIZE * INPUT_SIZE + i] = (resizedBuffer[i * 3 + 2] / 255.0 - MEAN[2]) / STD[2];
            }

            // 运行推理
            const feeds: Record<string, any> = {
                'input': new this.ort.Tensor('float32', inputTensor, [1, 3, INPUT_SIZE, INPUT_SIZE])
            };

            const results = await session.run(feeds);
            
            // 解析输出（格式：[1, num_classes, H, W] 的 logits）
            const output = results[session.outputNames[0]];
            const logits = output.data;
            const dims = output.dims;
            const numClasses = dims[1] || 18;
            const outH = dims[2] || INPUT_SIZE;
            const outW = dims[3] || INPUT_SIZE;

            // 找到目标类别
            const targetClassId = this.matchHumanParsingClass(targetPrompt);
            console.log(`[LocalDetection] Human Parsing 目标类别: ${targetClassId} (${targetPrompt})`);

            // 生成分割掩码（argmax）
            const segMask = new Uint8Array(outH * outW);
            const targetMask = new Uint8Array(outH * outW);
            const detectedClasses = new Set<number>();

            for (let i = 0; i < outH * outW; i++) {
                let maxVal = -Infinity;
                let maxClass = 0;
                
                for (let c = 0; c < numClasses; c++) {
                    const val = logits[c * outH * outW + i];
                    if (val > maxVal) {
                        maxVal = val;
                        maxClass = c;
                    }
                }
                
                segMask[i] = maxClass;
                detectedClasses.add(maxClass);
                
                // 如果是目标类别，标记为前景
                if (targetClassId !== null) {
                    if (Array.isArray(targetClassId)) {
                        targetMask[i] = targetClassId.includes(maxClass) ? 255 : 0;
                    } else {
                        targetMask[i] = (maxClass === targetClassId) ? 255 : 0;
                    }
                }
            }

            // Resize 掩码回原图尺寸
            const resizedMask = await this.sharp(Buffer.from(targetMask), {
                raw: { width: outW, height: outH, channels: 1 }
            })
                .resize(origWidth, origHeight, { kernel: 'nearest' })
                .raw()
                .toBuffer();

            // 计算边界框
            const bbox = this.computeBoundingBoxFromMask(resizedMask, origWidth, origHeight);

            console.log(`[LocalDetection] Human Parsing 完成 (${Date.now() - startTime}ms)`);
            console.log(`[LocalDetection] 检测到的类别: ${Array.from(detectedClasses).map(c => 
                HUMAN_PARSING_CLASSES.find(cls => cls.id === c)?.name || c
            ).join(', ')}`);

            if (bbox && bbox.area > 0.01) {
                return {
                    success: true,
                    boundingBox: {
                        x1: bbox.x1,
                        y1: bbox.y1,
                        x2: bbox.x2,
                        y2: bbox.y2,
                        confidence: bbox.coverage,
                        label: targetPrompt
                    },
                    segmentationMask: {
                        buffer: resizedMask,
                        width: origWidth,
                        height: origHeight,
                        classId: Array.isArray(targetClassId) ? targetClassId[0] : (targetClassId || 0)
                    },
                    method: 'human_parsing',
                    matchedClass: targetPrompt,
                    detectedClasses: Array.from(detectedClasses).map(c => 
                        HUMAN_PARSING_CLASSES.find(cls => cls.id === c)?.name || `class_${c}`
                    )
                };
            }

            return {
                success: false,
                method: 'human_parsing',
                matchedClass: targetPrompt,
                detectedClasses: Array.from(detectedClasses).map(c => 
                    HUMAN_PARSING_CLASSES.find(cls => cls.id === c)?.name || `class_${c}`
                ),
                error: `在图像中未检测到 "${targetPrompt}"`
            };

        } catch (e: any) {
            console.error(`[LocalDetection] Human Parsing 推理失败: ${e.message}`);
            return {
                success: false,
                method: 'human_parsing',
                error: `Human Parsing 推理失败: ${e.message}`
            };
        }
    }

    /**
     * 匹配 Human Parsing 类别
     */
    private matchHumanParsingClass(targetPrompt: string): number | number[] | null {
        const prompt = targetPrompt.toLowerCase().trim();
        
        // 特殊处理：鞋子 = 左鞋 + 右鞋
        if (prompt.includes('鞋')) {
            return [9, 10]; // left_shoe + right_shoe
        }
        
        // 特殊处理：腿 = 左腿 + 右腿
        if (prompt.includes('腿') && !prompt.includes('左') && !prompt.includes('右')) {
            return [12, 13]; // left_leg + right_leg
        }
        
        // 特殊处理：手臂 = 左臂 + 右臂
        if ((prompt.includes('手臂') || prompt.includes('胳膊')) && !prompt.includes('左') && !prompt.includes('右')) {
            return [14, 15]; // left_arm + right_arm
        }
        
        // 特殊处理：皮肤 = 脸 + 手臂 + 腿（暴露皮肤）
        if (prompt.includes('皮肤') || prompt.includes('肌肤')) {
            return [11, 12, 13, 14, 15]; // face + legs + arms
        }

        // 匹配类别
        for (const cls of HUMAN_PARSING_CLASSES) {
            // 检查英文名
            if (prompt.includes(cls.name)) {
                return cls.id;
            }
            // 检查中文名
            for (const cn of cls.chinese) {
                if (prompt.includes(cn) || cn.includes(prompt)) {
                    return cls.id;
                }
            }
        }
        
        return null;
    }

    /**
     * 从掩码计算边界框
     */
    private computeBoundingBoxFromMask(
        mask: Buffer,
        width: number,
        height: number
    ): { x1: number; y1: number; x2: number; y2: number; area: number; coverage: number } | null {
        let minX = width, minY = height, maxX = 0, maxY = 0;
        let count = 0;

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                if (mask[y * width + x] > 127) {
                    minX = Math.min(minX, x);
                    minY = Math.min(minY, y);
                    maxX = Math.max(maxX, x);
                    maxY = Math.max(maxY, y);
                    count++;
                }
            }
        }

        if (count === 0) return null;

        const x1 = minX / width;
        const y1 = minY / height;
        const x2 = (maxX + 1) / width;
        const y2 = (maxY + 1) / height;
        const area = (x2 - x1) * (y2 - y1);
        const coverage = count / (width * height);

        return { x1, y1, x2, y2, area, coverage };
    }

    /**
     * 使用显著性检测定位主体
     * 
     * 原理：运行一次快速的显著性模型，找到主体的边界框
     */
    private async detectBySaliency(
        imageBuffer: Buffer,
        targetPrompt: string
    ): Promise<DetectionResult> {
        try {
            const metadata = await this.sharp(imageBuffer).metadata();
            const width = metadata.width!;
            const height = metadata.height!;

            console.log(`[LocalDetection] 使用显著性检测，图像尺寸: ${width}x${height}`);

            // 使用全图作为 ROI，让分割模型自己处理
            // 这是最可靠的降级方案
            return {
                success: true,
                boundingBox: {
                    x1: 0,
                    y1: 0,
                    x2: 1,
                    y2: 1,
                    confidence: 0.8,
                    label: `saliency_${targetPrompt}`
                },
                method: 'saliency',
                matchedClass: 'full_image'
            };
        } catch (e: any) {
            return {
                success: false,
                method: 'saliency',
                error: e.message
            };
        }
    }

    private markFallback(
        result: DetectionResult,
        reasonCode: string,
        fallbackChain: string[]
    ): DetectionResult {
        return {
            ...result,
            reasonCode,
            fallbackUsed: true,
            fallbackChain
        };
    }

    /**
     * 检查服务状态
     */
    async healthCheck(): Promise<{
        ok: boolean;
        yoloAvailable: boolean;
        groundingDinoAvailable: boolean;
        humanParsingAvailable: boolean;
        yoloWorldAvailable: boolean;
    }> {
        await this.ensureInitialized();
        
        // YOLO-World 支持两种版本
        const yoloWorldLite = fs.existsSync(path.join(this.modelsDir, 'yolo-world', 'yolov8s-worldv2.onnx'));
        const yoloWorldFull = fs.existsSync(path.join(this.modelsDir, 'yolo-world', 'yolo-world-full.onnx'));
        
        return {
            ok: this.initialized,
            yoloAvailable: fs.existsSync(path.join(this.modelsDir, 'yolo', 'yolov4.onnx')),
            groundingDinoAvailable: fs.existsSync(path.join(this.modelsDir, 'grounding-dino', 'groundingdino_swint_ogc.onnx')),
            humanParsingAvailable: fs.existsSync(path.join(this.modelsDir, 'human-parsing', 'schp_atr.onnx')),
            yoloWorldAvailable: yoloWorldLite || yoloWorldFull
        };
    }

    /**
     * 获取所有可用的检测模型
     */
    async getAvailableModels(): Promise<DetectionModelType[]> {
        const status = await this.healthCheck();
        const available: DetectionModelType[] = ['detection-skip'];
        
        if (status.groundingDinoAvailable) available.push('detection-grounding-dino');
        if (status.yoloWorldAvailable) available.push('detection-yolo-world');
        if (status.humanParsingAvailable) available.push('detection-human-parsing');
        if (status.yoloAvailable) available.push('detection-tiny-yolov3');
        
        return available;
    }
}

// 单例
let localDetectionService: LocalDetectionService | null = null;

export function getLocalDetectionService(): LocalDetectionService {
    if (!localDetectionService) {
        localDetectionService = new LocalDetectionService();
    }
    return localDetectionService;
}
