/**
 * 任务类型定义
 */

export type TaskType = 
    | 'layout-analysis'      // 排版分析
    | 'layout-fix'           // 排版修复
    | 'text-optimize'        // 文案优化
    | 'reference-analyze'    // 参考图分析
    | 'visual-compare'       // 视觉对比
    | 'image-generate';      // 图像生成

export interface TaskRouting {
    taskType: TaskType;
    primaryModel: string;
    fallbackModel?: string;
    reason: string;
}

/**
 * 开发模式标志
 * 设置为 true 时使用本地 Ollama 模型，节省 API 费用
 */
export const USE_DEV_MODE = true;  // 改为 false 使用云端模型

/**
 * 生产环境任务路由配置（使用云端 API）
 */
export const PRODUCTION_ROUTING: TaskRouting[] = [
    {
        taskType: 'layout-analysis',
        primaryModel: 'claude-3-5-sonnet',
        fallbackModel: 'claude-3-opus',
        reason: 'Claude 在逻辑推理和结构化输出上最优'
    },
    {
        taskType: 'layout-fix',
        primaryModel: 'claude-3-5-sonnet',
        reason: 'Claude 能精准生成 batchPlay 代码'
    },
    {
        taskType: 'text-optimize',
        primaryModel: 'gpt-4o',
        fallbackModel: 'claude-3-5-sonnet',
        reason: 'GPT-4o 的营销文案语感最佳'
    },
    {
        taskType: 'reference-analyze',
        primaryModel: 'gemini-3-flash',
        fallbackModel: 'gemini-3-pro-preview',
        reason: 'Gemini 视觉理解能力强，且成本低'
    },
    {
        taskType: 'visual-compare',
        primaryModel: 'gemini-3-flash',
        fallbackModel: 'gemini-3-pro-preview',
        reason: 'Gemini 适合多图对比'
    },
    {
        taskType: 'image-generate',
        primaryModel: 'adobe-firefly',
        reason: '商业合规，版权安全'
    }
];

/**
 * 开发环境任务路由配置（使用本地 Ollama 模型）
 * 免费、快速、适合调试
 */
export const DEV_ROUTING: TaskRouting[] = [
    {
        taskType: 'layout-analysis',
        primaryModel: 'local-deepseek-coder-v2-16b',
        fallbackModel: 'local-qwen2.5-7b',
        reason: 'DeepSeek Coder 擅长结构化输出和代码生成'
    },
    {
        taskType: 'layout-fix',
        primaryModel: 'local-deepseek-coder-v2-16b',
        fallbackModel: 'local-qwen2.5-7b',
        reason: 'DeepSeek Coder 能生成 batchPlay 代码'
    },
    {
        taskType: 'text-optimize',
        primaryModel: 'local-qwen2.5-7b',
        fallbackModel: 'local-qwen2.5-14b',
        reason: 'Qwen2.5 中文文案能力强'
    },
    {
        taskType: 'reference-analyze',
        primaryModel: 'ollama-llava:7b',
        fallbackModel: 'ollama-llava:13b',
        reason: 'LLaVA 支持视觉理解'
    },
    {
        taskType: 'visual-compare',
        primaryModel: 'ollama-llava:7b',
        fallbackModel: 'ollama-llava:13b',
        reason: 'LLaVA 支持图像对比'
    },
    {
        taskType: 'image-generate',
        primaryModel: 'adobe-firefly',  // 图像生成仍需要云端
        reason: '图像生成需要专业模型'
    }
];

/**
 * 当前使用的任务路由
 */
export const TASK_ROUTING: TaskRouting[] = USE_DEV_MODE ? DEV_ROUTING : PRODUCTION_ROUTING;

/**
 * 获取任务路由
 */
export function getTaskRouting(taskType: TaskType): TaskRouting | undefined {
    return TASK_ROUTING.find(r => r.taskType === taskType);
}
