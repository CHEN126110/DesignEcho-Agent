export type PhotoshopToolErrorCategory =
    | 'photoshop_command_unavailable'
    | 'image_decode_error'
    | 'modal_state'
    | 'font_unavailable'
    | 'missing_target'
    | 'tool_execution_error';

export interface NormalizePhotoshopToolErrorInput {
    toolName: string;
    error: unknown;
}

export interface NormalizedPhotoshopToolError {
    handledBy: 'tool-error-normalizer/v1';
    toolName: string;
    category: PhotoshopToolErrorCategory;
    message: string;
    userMessage: string;
    suggestedAction: string;
    retryable: boolean;
    popupRisk: boolean;
}

export interface CreateToolFailureResultInput extends NormalizePhotoshopToolErrorInput {
    params?: unknown;
}

export interface ToolFailureResult {
    success: false;
    error: string;
    errorDetails: NormalizedPhotoshopToolError & {
        paramsSummary?: unknown;
    };
    data: null;
}

export function normalizePhotoshopToolError(input: NormalizePhotoshopToolErrorInput): NormalizedPhotoshopToolError {
    const toolName = String(input.toolName || 'unknown');
    const message = extractErrorMessage(input.error);
    const category = classifyPhotoshopToolError(message);

    return {
        handledBy: 'tool-error-normalizer/v1',
        toolName,
        category,
        message,
        userMessage: buildUserMessage(toolName, category, message),
        suggestedAction: buildSuggestedAction(toolName, category),
        retryable: isRetryable(category),
        popupRisk: hasPopupRisk(category)
    };
}

export function createToolFailureResult(input: CreateToolFailureResultInput): ToolFailureResult {
    const normalized = normalizePhotoshopToolError(input);
    return {
        success: false,
        error: normalized.userMessage,
        errorDetails: {
            ...normalized,
            paramsSummary: summarizeParams(input.params)
        },
        data: null
    };
}

function extractErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message || error.name || 'Unknown error';
    }
    if (typeof error === 'string') {
        return error;
    }
    if (error && typeof error === 'object') {
        const record = error as Record<string, unknown>;
        if (typeof record.message === 'string') {
            return record.message;
        }
        if (typeof record.error === 'string') {
            return record.error;
        }
    }
    return String(error || 'Unknown error');
}

function classifyPhotoshopToolError(message: string): PhotoshopToolErrorCategory {
    if (/IDAT|END\[AE\]|bad header|invalid distances|invalid type|decode|decompress|corrupt png|PNG .*校验失败/i.test(message)) {
        return 'image_decode_error';
    }
    if (/command\s+"?(move|select|set|transform)"?\s+is not currently available|命令.*当前不可用/i.test(message)) {
        return 'photoshop_command_unavailable';
    }
    if (/host is in a modal state|modal|模态状态|正在处理其他命令/i.test(message)) {
        return 'modal_state';
    }
    if (/未找到可用字体|找不到可用字体|font.+not found|font.+unavailable|字体.+不存在|字体写入未生效/i.test(message)) {
        return 'font_unavailable';
    }
    if (/not found|未找到|没有选中|无法读取图层当前位置|target/i.test(message)) {
        return 'missing_target';
    }
    return 'tool_execution_error';
}

function buildUserMessage(toolName: string, category: PhotoshopToolErrorCategory, message: string): string {
    switch (category) {
        case 'image_decode_error':
            return `${toolName} 执行前检测到图片解码风险，已中止操作，避免 Photoshop 弹出图片解析错误。`;
        case 'photoshop_command_unavailable':
            return `${toolName} 调用的 Photoshop 命令当前不可用，已中止操作。`;
        case 'modal_state':
            return `${toolName} 暂时无法执行：Photoshop 当前处于模态状态或正在处理其他命令。`;
        case 'font_unavailable':
            return `${toolName} 字体不可用：${message}`;
        case 'missing_target':
            return `${toolName} 缺少可操作的目标对象，请先确认文档、图层或目标 ID。`;
        case 'tool_execution_error':
            return `${toolName} 执行失败：${message}`;
    }
}

function buildSuggestedAction(toolName: string, category: PhotoshopToolErrorCategory): string {
    if (category === 'image_decode_error') {
        return '重新导出或转换这张图片后再置入；PNG/JPG 文件必须先通过置入前二进制检查。';
    }
    if (category === 'photoshop_command_unavailable') {
        if (toolName === 'moveLayer') {
            return '如果目标是调整画布位置，先确认目标图层未锁定且不是背景层；如果目标是调整图层堆叠顺序，应改用 reorderLayer。';
        }
        if (toolName === 'reorderLayer') {
            return '先读取图层层级并确认目标层与参考层在同一父级；跨组移动应使用 moveLayerToGroup。';
        }
        return '先读取 Photoshop 当前文档和目标图层状态，再选择可用工具执行。';
    }
    if (category === 'modal_state') {
        return '等待 Photoshop 当前模态操作结束后重试；不要在未确认状态时连续发送写操作。';
    }
    if (category === 'font_unavailable') {
        return '先调用 resolveFontName 确认 Photoshop 可写入的字体 PostScript 名；解析失败时不要继续写入或静默 fallback。';
    }
    if (category === 'missing_target') {
        return '先调用 listDocuments、getLayerHierarchy 或 getLayerProperties 确认目标，再执行写操作。';
    }
    return '保留错误上下文，先诊断文档和图层状态，不要用默认值继续写入。';
}

function isRetryable(category: PhotoshopToolErrorCategory): boolean {
    return category === 'modal_state';
}

function hasPopupRisk(category: PhotoshopToolErrorCategory): boolean {
    return category === 'image_decode_error' || category === 'photoshop_command_unavailable';
}

function summarizeParams(params: unknown): unknown {
    if (!params || typeof params !== 'object') {
        return params;
    }

    const output: Record<string, unknown> = {};
    const record = params as Record<string, unknown>;
    for (const key of Object.keys(record)) {
        const value = record[key];
        if (isPathKey(key)) {
            output[key] = basenameOnly(value);
            continue;
        }
        if (typeof value === 'string' && value.length > 160) {
            output[key] = `${value.slice(0, 80)}...(${value.length} chars)`;
            continue;
        }
        output[key] = value;
    }
    return output;
}

function isPathKey(key: string): boolean {
    return /path|file|directory/i.test(key);
}

function basenameOnly(value: unknown): unknown {
    if (typeof value !== 'string') {
        return value;
    }
    const normalized = value.replace(/\\/g, '/');
    const name = normalized.split('/').filter(Boolean).pop();
    return name || '[redacted-path]';
}
