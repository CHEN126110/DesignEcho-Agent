/**
 * 工具结果整理（纯逻辑，可被 smoke 直接测试）
 *
 * 两个职责：
 * 1. sanitizeToolOutputForModel：回填给模型的工具结果做超长字段截断——
 *    此前快照 base64 以完整 JSON 文本进入上下文（token 炸弹且模型无法作为图像理解）
 * 2. extractImageFromToolResult：从快照类工具结果中提取图像，
 *    由 Agent 循环以 user 图像消息回传给视觉模型（模型"看着画布"工作的基础）
 */

/** 单个字符串字段截断阈值（base64 等长字段超过即截断） */
const MAX_STRING_FIELD_CHARS = 1500;
/** 数组保留条数上限 */
const MAX_ARRAY_ITEMS = 50;
/**
 * 深度上限，防御循环引用之外的深结构。
 * 图层树每层组占 2 级 JSON 深度（组对象 + children 数组）：6 只能穿透约 3 层组嵌套，
 * 真机详情页（详情页>屏组>图片/文案>层）被剪成「嵌套过深」——rootLayerId 子树也照样被剪。
 * 放宽到 14（约 7 层组嵌套）；字符串/数组上限仍在，上下文保护不失效。
 * 查特定图层优先用 findLayers（扁平结果，不吃深度），不靠翻树。
 */
const MAX_DEPTH = 14;
/** 识别为图像 base64 的最小长度 */
const MIN_IMAGE_BASE64_CHARS = 500;

export interface ToolResultImage {
    data: string;
    mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
}

/** 深度截断工具输出中的超长字段，返回可安全序列化给模型的副本 */
export function sanitizeToolOutputForModel(value: any, depth = 0): any {
    if (depth > MAX_DEPTH) return '[嵌套过深，已省略]';
    if (typeof value === 'string') {
        if (value.length > MAX_STRING_FIELD_CHARS) {
            return `${value.slice(0, MAX_STRING_FIELD_CHARS)}…[已截断，原长 ${value.length} 字符]`;
        }
        return value;
    }
    if (Array.isArray(value)) {
        const limited = value.slice(0, MAX_ARRAY_ITEMS).map(item => sanitizeToolOutputForModel(item, depth + 1));
        if (value.length > MAX_ARRAY_ITEMS) {
            limited.push(`[数组共 ${value.length} 项，仅保留前 ${MAX_ARRAY_ITEMS} 项]`);
        }
        return limited;
    }
    if (value && typeof value === 'object') {
        const out: Record<string, any> = {};
        for (const [key, val] of Object.entries(value)) {
            out[key] = sanitizeToolOutputForModel(val, depth + 1);
        }
        return out;
    }
    return value;
}

function resolveMediaType(formatHint: string, fallback: ToolResultImage['mediaType'] = 'image/png'): ToolResultImage['mediaType'] {
    const hint = String(formatHint || '').toLowerCase();
    if (hint.includes('jpeg') || hint.includes('jpg')) return 'image/jpeg';
    if (hint.includes('webp')) return 'image/webp';
    if (hint.includes('png')) return 'image/png';
    return fallback;
}

/**
 * 从工具结果中提取图像（base64 或 data-url）。
 * 检查快照类工具的常见字段；返回 null 表示该结果不含可用图像。
 *
 * 形状必须覆盖真实 UXP 返回（视神经断裂病例 2026-07-07）：
 * - getCanvasSnapshot 返回嵌套 `snapshot: { base64, format, ... }`——此前候选列表只认
 *   字符串字段，全系统调用量最大的像素眼「成功」了 16 次却没有一张图真正进过模型，
 *   模型在「以为自己看过」的状态下做设计（run-record 实证：92 会话中该工具图像转发 0 次）。
 * - getScreenSnapshots 的图像在 `screens[].base64` 数组元素里，同断。
 */
export function extractImageFromToolResult(output: any): ToolResultImage | null {
    if (!output || typeof output !== 'object') return null;
    const firstScreenWithImage = Array.isArray(output.screens)
        ? output.screens.find((screen: any) => typeof screen?.base64 === 'string')
        : undefined;
    const candidates: Array<{ value: unknown; formatHint: string }> = [
        { value: output.base64, formatHint: String(output.format || output.mimeType || '') },
        { value: output.imageData, formatHint: String(output.format || output.mimeType || '') },
        { value: output.snapshot, formatHint: String(output.format || output.mimeType || '') },
        // 嵌套快照对象（getCanvasSnapshot 真实形状）：format 在嵌套层内
        { value: output?.snapshot?.base64, formatHint: String(output?.snapshot?.format || '') },
        { value: output?.snapshot?.imageData, formatHint: String(output?.snapshot?.format || '') },
        { value: output?.data?.base64, formatHint: String(output?.data?.format || output.format || '') },
        { value: output?.data?.imageData, formatHint: String(output?.data?.format || output.format || '') },
        { value: output?.data?.snapshot?.base64, formatHint: String(output?.data?.snapshot?.format || '') },
        // 分屏快照数组（getScreenSnapshots）：取第一张有图的屏
        { value: firstScreenWithImage?.base64, formatHint: String(firstScreenWithImage?.format || '') }
    ];
    for (const { value: candidate, formatHint } of candidates) {
        if (typeof candidate !== 'string' || candidate.length < MIN_IMAGE_BASE64_CHARS) continue;

        const dataUrlMatch = candidate.match(/^data:(image\/(?:png|jpeg|webp));base64,([\s\S]+)$/);
        if (dataUrlMatch) {
            return {
                data: dataUrlMatch[2].replace(/[\r\n]/g, ''),
                mediaType: dataUrlMatch[1] as ToolResultImage['mediaType']
            };
        }

        // 原始 base64：抽样校验字符集，避免把普通长文本当图像
        if (/^[A-Za-z0-9+/=\r\n]+$/.test(candidate.slice(0, 1000))) {
            return {
                data: candidate.replace(/[\r\n]/g, ''),
                mediaType: resolveMediaType(formatHint)
            };
        }
    }
    return null;
}
