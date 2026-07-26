const OPERATION_CONFIG: Record<string, { icon: string; name: string }> = {
    'remove-background': { icon: '✂️', name: '智能抠图' },
    'remove-background-multi': { icon: '🎯', name: '多目标抠图' },
    'one-click-beautify': { icon: '✨', name: '一键美化' },
    'optimize-text': { icon: '📝', name: '撰写文案' },
    'analyze-layout': { icon: '📐', name: '排版分析' },
    'shape-morph': { icon: '◇', name: '形态统一' },
    'inpaint': { icon: '✎', name: '局部重绘' },
    'image-to-image': { icon: '🖼️', name: '图生图' },
    'morphing': { icon: '◇', name: '形态变形' },
    'harmonize': { icon: '⊕', name: '协调融合' }
};

const DEFAULT_OPERATION = { icon: '⏳', name: '处理中' };

const ENGLISH_TO_CHINESE: Array<[RegExp, string]> = [
    [/extracting image/gi, '提取图像'],
    [/processing/gi, '处理中'],
    [/analyzing/gi, '分析中'],
    [/detecting/gi, '检测中'],
    [/segmenting/gi, '分割中'],
    [/initializing/gi, '初始化中'],
    [/loading model/gi, '加载模型'],
    [/mask/gi, '蒙版'],
    [/edge/gi, '边缘'],
    [/refining/gi, '优化中']
];

/**
 * 将技术性进度消息转换为用户友好的中文提示。
 */
export function getFriendlyProgressMessage(operation: string, progress: number, message?: string): {
    message: string;
    hint: string;
    loadingText: string;
} {
    const opConfig = OPERATION_CONFIG[operation] || DEFAULT_OPERATION;
    let hintText = message || '正在处理...';

    const isEnglishOnly = message && !/[\u4e00-\u9fa5]/.test(message);
    if (isEnglishOnly) {
        for (const [pattern, replacement] of ENGLISH_TO_CHINESE) {
            hintText = hintText.replace(pattern, replacement);
        }
    }

    return {
        message: `${opConfig.icon} ${opConfig.name} ${progress}%`,
        hint: hintText,
        loadingText: hintText
    };
}
