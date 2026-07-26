export interface PhotoshopToolArgumentNormalizationOptions {
    sourceText?: string;
}

function isPlainObject(value: unknown): value is Record<string, any> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizePercentNumber(value: unknown): unknown {
    if (typeof value === 'string') {
        const trimmed = value.trim();
        const percentMatch = trimmed.match(/^(-?\d+(?:\.\d+)?)\s*%$/);
        if (percentMatch) {
            const parsed = Number(percentMatch[1]);
            return Number.isFinite(parsed) ? parsed : value;
        }
        const parsed = Number(trimmed);
        if (!Number.isFinite(parsed)) return value;
        value = parsed;
    }

    if (typeof value !== 'number' || !Number.isFinite(value)) return value;
    if (value > 0 && value <= 1) {
        return Math.round(value * 10000) / 100;
    }
    return value;
}

function parseHexColor(value: unknown): { r: number; g: number; b: number } | null {
    const raw = String(value || '').trim();
    const match = raw.match(/^#?([0-9a-f]{6})$/i);
    if (!match) return null;
    const hex = match[1];
    return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16)
    };
}

function readSingleHexColor(text: unknown): { r: number; g: number; b: number } | null {
    const matches = String(text || '').match(/#[0-9a-f]{6}\b/gi) || [];
    const unique = Array.from(new Set(matches.map((item) => item.toUpperCase())));
    if (unique.length !== 1) return null;
    return parseHexColor(unique[0]);
}

function inferPercentNearKeyword(text: unknown, keywords: RegExp[]): number | null {
    const source = String(text || '');
    if (!source.trim()) return null;

    for (const keyword of keywords) {
        const match = keyword.exec(source);
        if (!match || match.index === undefined) continue;
        const windowText = source.slice(Math.max(0, match.index - 80), match.index + 120);
        const percentMatch = windowText.match(/(?:不透明度|透明度|opacity)[^\d]{0,16}(\d+(?:\.\d+)?)\s*%?|(\d+(?:\.\d+)?)\s*%[^\n，。；,;]{0,16}(?:不透明度|透明度|opacity)/i);
        const value = Number(percentMatch?.[1] ?? percentMatch?.[2]);
        if (Number.isFinite(value)) return value;
    }

    return null;
}

function normalizeRgbColor(value: unknown): unknown {
    if (!isPlainObject(value)) return value;
    const r = Number(value.r);
    const g = Number(value.g);
    const b = Number(value.b);
    if (![r, g, b].every((component) => Number.isFinite(component) && component >= 0 && component <= 255)) {
        return value;
    }
    return {
        r: Math.round(r),
        g: Math.round(g),
        b: Math.round(b)
    };
}

function normalizeColorArgument(
    toolName: string,
    args: Record<string, any>,
    options: PhotoshopToolArgumentNormalizationOptions
): unknown {
    const explicitHex = parseHexColor(args.colorHex);
    if (explicitHex) return explicitHex;

    if (toolName === 'addStroke') {
        const sourceHex = readSingleHexColor(options.sourceText);
        if (sourceHex) return sourceHex;
    }

    return normalizeRgbColor(args.color);
}

function inferRasterFormatFromPath(value: unknown): string | null {
    const raw = String(value || '').trim().toLowerCase();
    const match = raw.match(/\.([a-z0-9]+)(?:[?#].*)?$/);
    const ext = match?.[1];
    if (ext === 'png') return 'png';
    if (ext === 'jpg' || ext === 'jpeg') return 'jpg';
    return null;
}

/** alignLayers 的 UXP 执行器（DesignEcho-UXP/src/tools/layout/align-layers.ts）只读必填 alignType 的合法枚举。 */
const ALIGN_LAYERS_ALIGN_TYPES = new Set(['left', 'center', 'right', 'top', 'middle', 'bottom']);

/**
 * alignLayers 双名兼容：Agent 侧 schema 与提示词历史上用 alignment，UXP 执行器读必填 alignType。
 * 只在 alignType 缺失且 alignment 是合法枚举时补齐映射；非法枚举值不猜测、不伪造，
 * 保留原参数让执行端返回真实错误。alignment 原样保留（两名兼容，UXP 侧忽略未知字段）。
 */
function normalizeAlignLayersArguments(normalized: Record<string, any>): void {
    if (normalized.alignType !== undefined) return;
    if (typeof normalized.alignment !== 'string') return;
    const candidate = normalized.alignment.trim();
    if (ALIGN_LAYERS_ALIGN_TYPES.has(candidate)) {
        normalized.alignType = candidate;
    }
}

/**
 * 严格解析缩放百分比：只接受有限 number 或非空可解析数字字符串，其余一律丢弃。
 * 不能用裸 Number() 强转——Number('')=0、Number(false)=0、Number([80])=80 都会把
 * 垃圾输入变成"有效缩放"，空串甚至会产出 scale:{x:0} 让 UXP 执行 resize(0,...)。
 */
function toFiniteScalePercent(value: unknown): number | undefined {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : undefined;
    }
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed === '') return undefined;
        const parsed = Number(trimmed);
        return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
}

/**
 * transformLayer 平铺缩放参数兼容：Agent 侧 schema 对模型暴露 scaleX/scaleY（平铺形式模型更稳），
 * UXP 执行器（DesignEcho-UXP/src/tools/layer/transform-layer.ts）读嵌套 scale:{x,y}。
 * 仅在模型未直接给出 scale 对象时转换；无法严格解析的值直接丢弃，不猜测默认值。
 */
function normalizeTransformLayerScaleArguments(normalized: Record<string, any>): void {
    const hasFlatScale = normalized.scaleX !== undefined || normalized.scaleY !== undefined;
    if (!hasFlatScale) return;
    const scaleX = toFiniteScalePercent(normalized.scaleX);
    const scaleY = toFiniteScalePercent(normalized.scaleY);
    if (!isPlainObject(normalized.scale) && (scaleX !== undefined || scaleY !== undefined)) {
        const scale: Record<string, number> = {};
        if (scaleX !== undefined) scale.x = scaleX;
        if (scaleY !== undefined) scale.y = scaleY;
        normalized.scale = scale;
    }
    delete normalized.scaleX;
    delete normalized.scaleY;
}

/**
 * 已知嵌套对象参数剥 null：顶层归一化只过滤第一层 null（见 normalizePhotoshopToolArguments），
 * 而模型高频把嵌套对象里没用的字段填 null（如 targetBounds:{x:100, left:null}）。
 * null 若透传到执行端/验收端，任何 Number(null)=0 式解析都会被污染，这里在入口先剥掉。
 * 执行端（UXP transform-layer.ts / place-image.ts）与验收端（tool-acceptance.ts）的
 * targetBounds 解析各自仍做 null 安全，多层防御，不依赖本函数单点兜底。
 */
function stripNullEntriesFromObjectParam(normalized: Record<string, any>, key: string): void {
    if (!isPlainObject(normalized[key])) return;
    normalized[key] = Object.fromEntries(
        Object.entries(normalized[key]).filter(([, value]) => value !== undefined && value !== null)
    );
}

export function normalizePhotoshopToolArguments(
    toolName: string,
    args: Record<string, any> | undefined,
    options: PhotoshopToolArgumentNormalizationOptions = {}
): Record<string, any> {
    if (!isPlainObject(args)) return {};

    const normalized: Record<string, any> = Object.fromEntries(
        Object.entries(args).filter(([, value]) => value !== undefined && value !== null)
    );

    if (['setLayerOpacity', 'addStroke', 'addDropShadow', 'addGlow', 'addGradientOverlay'].includes(toolName)
        && normalized.opacity !== undefined) {
        normalized.opacity = normalizePercentNumber(normalized.opacity);
    }
    if (toolName === 'addStroke'
        && normalized.opacity === undefined
        && /(完全不透明|100\s*%|opacity\s*[:=]?\s*100)/i.test(String(options.sourceText || ''))) {
        normalized.opacity = 100;
    }
    if (toolName === 'addDropShadow' && normalized.opacity === undefined) {
        const inferred = inferPercentNearKeyword(options.sourceText, [/投影|阴影|drop\s*shadow|shadow/i]);
        if (inferred !== null) normalized.opacity = inferred;
    }
    if (toolName === 'addGlow' && normalized.opacity === undefined) {
        const inferred = inferPercentNearKeyword(options.sourceText, [/发光|glow/i]);
        if (inferred !== null) normalized.opacity = inferred;
    }

    if (['addDropShadow', 'addGlow'].includes(toolName) && normalized.spread !== undefined) {
        normalized.spread = normalizePercentNumber(normalized.spread);
    }

    if (['addStroke', 'addDropShadow', 'addGlow'].includes(toolName)
        && (normalized.color !== undefined || normalized.colorHex !== undefined || options.sourceText)) {
        const color = normalizeColorArgument(toolName, normalized, options);
        if (color !== undefined && color !== null) {
            normalized.color = color;
        }
    }

    if (toolName === 'quickExport' && normalized.format === undefined) {
        const inferredFormat = inferRasterFormatFromPath(normalized.outputPath);
        if (inferredFormat) normalized.format = inferredFormat;
    }

    if (toolName === 'alignLayers') {
        normalizeAlignLayersArguments(normalized);
    }

    if (toolName === 'transformLayer') {
        normalizeTransformLayerScaleArguments(normalized);
    }

    if (toolName === 'transformLayer' || toolName === 'placeImage') {
        stripNullEntriesFromObjectParam(normalized, 'targetBounds');
    }

    delete normalized.colorHex;
    return normalized;
}
