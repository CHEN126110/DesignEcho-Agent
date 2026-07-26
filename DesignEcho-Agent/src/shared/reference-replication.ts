export interface ReferenceParseElement {
    type?: string;
    role?: string;
    name?: string;
    content?: string;
    style?: ReferenceParseElementStyle;
    position?: { x?: number; y?: number };
    size?: { width?: number; height?: number };
    relationship?: {
        anchors?: string[];
        overlaps?: string[];
        group?: string;
    };
    visualWeight?: string;
    zIndex?: number;
}

export interface ReferenceParseElementStyle {
    fillColor?: string;
    textColor?: string;
    strokeColor?: string;
    opacity?: number;
    cornerRadius?: number;
    fontWeight?: string;
    fontSizeRatio?: number;
    tracking?: number;
    leading?: number;
    lineHeightRatio?: number;
    effects?: string[];
}

export interface ReferenceParseResult {
    layoutType: string;
    designIntent?: string;
    canvasSize: {
        width: number;
        height: number;
    };
    composition?: {
        focalPoint?: string;
        readingOrder?: string[];
        density?: string;
        symmetry?: string;
    };
    elements: ReferenceParseElement[];
    alignmentGroups: Array<{ type?: string; elementIndices?: number[] }>;
}

export type MinimalDesignRole =
    | 'headline'
    | 'supporting-copy'
    | 'hero-asset'
    | 'cta'
    | 'background'
    | 'brand'
    | 'decoration'
    | 'badge'
    | 'unknown';

export type MinimalDesignNodeKind =
    | 'text'
    | 'image'
    | 'shape'
    | 'background'
    | 'unknown';

export interface MinimalDesignElement {
    id: string;
    sourceType: string;
    name: string;
    role: MinimalDesignRole;
    nodeKind: MinimalDesignNodeKind;
    content?: string;
    style?: MinimalDesignElementStyle;
    box: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    relation?: {
        anchors?: string[];
        overlaps?: string[];
        group?: string;
    };
    visualWeight?: 'primary' | 'secondary' | 'tertiary' | 'unknown';
    zIndex: number;
}

export interface MinimalDesignElementStyle {
    fillColor?: string;
    textColor?: string;
    strokeColor?: string;
    opacity?: number;
    cornerRadius?: number;
    fontWeight?: string;
    fontSizeRatio?: number;
    tracking?: number;
    leading?: number;
    lineHeightRatio?: number;
    effects: string[];
}

export interface MinimalDesignRepresentation {
    canvas: {
        width: number;
        height: number;
    };
    layout: {
        layoutType: string;
        designIntent?: string;
        focalPoint?: string;
        readingOrder?: string[];
        density?: string;
        symmetry?: string;
    };
    elements: MinimalDesignElement[];
    alignmentGroups: Array<{ type?: string; elementIndices?: number[] }>;
}

function clamp01(value: number, fallback = 0): number {
    if (!Number.isFinite(value)) return fallback;
    return Math.max(0, Math.min(1, value));
}

function toFiniteNumber(value: unknown): number | null {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
}

function normalizeRequiredUnit(value: unknown, options: { allowZero?: boolean } = {}): number | null {
    const numeric = toFiniteNumber(value);
    if (numeric === null) return null;
    if (numeric < 0 || numeric > 1) return null;
    if (!options.allowZero && numeric <= 0) return null;
    return numeric;
}

function normalizeCanvasSize(raw: any): ReferenceParseResult['canvasSize'] | null {
    const width = toFiniteNumber(raw?.width);
    const height = toFiniteNumber(raw?.height);
    if (width === null || height === null || width <= 0 || height <= 0) return null;
    return {
        width: Math.round(width),
        height: Math.round(height)
    };
}

function normalizeReferenceElementGeometry(el: any): {
    position: { x: number; y: number };
    size: { width: number; height: number };
} | null {
    const x = normalizeRequiredUnit(el?.position?.x, { allowZero: true });
    const y = normalizeRequiredUnit(el?.position?.y, { allowZero: true });
    const width = normalizeRequiredUnit(el?.size?.width);
    const height = normalizeRequiredUnit(el?.size?.height);
    if (x === null || y === null || width === null || height === null) return null;
    return {
        position: { x, y },
        size: { width, height }
    };
}

function normalizeColor(value: unknown): string | undefined {
    const raw = String(value || '').trim();
    if (!raw) return undefined;
    const hex = raw.match(/^#?[0-9a-fA-F]{6}$/);
    if (hex) return raw.startsWith('#') ? raw.toUpperCase() : `#${raw.toUpperCase()}`;
    const rgb = raw.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
    if (rgb) {
        const parts = rgb.slice(1, 4).map((item) => {
            const n = Math.max(0, Math.min(255, Math.round(Number(item) || 0)));
            return n.toString(16).padStart(2, '0').toUpperCase();
        });
        return `#${parts.join('')}`;
    }
    return undefined;
}

function normalizeStyle(raw: any): MinimalDesignElementStyle | undefined {
    if (!raw || typeof raw !== 'object') return undefined;
    const effects = Array.isArray(raw.effects)
        ? raw.effects.map((item: unknown) => String(item || '').trim()).filter(Boolean).slice(0, 6)
        : [];
    const style: MinimalDesignElementStyle = {
        fillColor: normalizeColor(raw.fillColor),
        textColor: normalizeColor(raw.textColor),
        strokeColor: normalizeColor(raw.strokeColor),
        opacity: raw.opacity === undefined ? undefined : clamp01(Number(raw.opacity), 1),
        cornerRadius: raw.cornerRadius === undefined ? undefined : Math.max(0, Math.min(80, Number(raw.cornerRadius) || 0)),
        fontWeight: typeof raw.fontWeight === 'string' ? raw.fontWeight : undefined,
        fontSizeRatio: raw.fontSizeRatio === undefined ? undefined : clamp01(Number(raw.fontSizeRatio), 0),
        tracking: raw.tracking === undefined ? undefined : Math.max(-1000, Math.min(1000, Number(raw.tracking) || 0)),
        leading: raw.leading === undefined ? undefined : Math.max(1, Math.min(400, Number(raw.leading) || 0)),
        lineHeightRatio: raw.lineHeightRatio === undefined ? undefined : Math.max(0.6, Math.min(3, Number(raw.lineHeightRatio) || 0)),
        effects
    };

    if (
        !style.fillColor &&
        !style.textColor &&
        !style.strokeColor &&
        style.opacity === undefined &&
        style.cornerRadius === undefined &&
        !style.fontWeight &&
        !style.fontSizeRatio &&
        style.tracking === undefined &&
        style.leading === undefined &&
        style.lineHeightRatio === undefined &&
        effects.length === 0
    ) {
        return undefined;
    }
    return style;
}

function normalizeRole(value: unknown): MinimalDesignRole {
    const role = String(value || '').trim().toLowerCase();
    if (
        role === 'headline' ||
        role === 'supporting-copy' ||
        role === 'hero-asset' ||
        role === 'cta' ||
        role === 'background' ||
        role === 'brand' ||
        role === 'decoration' ||
        role === 'badge'
    ) {
        return role;
    }
    return 'unknown';
}

function inferNodeKind(type: string, role: MinimalDesignRole): MinimalDesignNodeKind {
    const normalizedType = String(type || '').toLowerCase();
    if (role === 'background') return 'background';
    if (/title|text|copy|cta|logo|tag|badge/.test(normalizedType)) return 'text';
    if (/image|photo|product|model|hero|kv|picture/.test(normalizedType)) return 'image';
    if (/shape|decoration|line|frame|panel/.test(normalizedType)) return 'shape';
    return 'unknown';
}

export function buildReferenceParsePrompt(): string {
    return [
        '你是电商设计参考图逆向分析专家。',
        '目标是输出一份可执行设计蓝图，用于在 Photoshop 中复刻参考图，而不是泛泛描述图片。',
        '请严格输出 JSON，不要解释。',
        'style.effects 只能使用受控词表：shadow、stroke、glow、blur、gradient；无法判断时留空，不要编造效果名。',
        '基础颜色、透明度、圆角、字号比例要尽量填写；这些字段会直接影响 Photoshop 骨架落地。',
        'position.x/y 必须是元素视觉外接框左上角相对画布宽高的归一化坐标，不是中心点、不是基线、不是文本框锚点。',
        'size.width/height 必须是元素视觉外接框宽高相对画布宽高的归一化尺寸；不要用整行区域或父容器尺寸替代文字黑色像素外接框。',
        '文本元素必须按视觉上独立的一行或一块输出，不要把左右两列、多行参数或标题正文合并成一个元素。',
        '文本内容必须逐字保留参考图中的中文、英文、数字、斜杠、连字符、冒号和百分号；不要改写、补全或省略。',
        '文本元素的 fontSizeRatio 表示估计字号除以画布高度；如果能判断字号，必须填写，便于 Photoshop 创建可编辑文本层。',
        '文本元素如能判断字距或行高，可填写 tracking、leading 或 lineHeightRatio；不确定时省略，不要编造。',
        'canvasSize 必须使用参考图真实像素尺寸；除非用户明确要求输出尺寸，不要自动放大到 800、1242 或详情页尺寸。',
        '{',
        '  "layoutType": "center|left-right|top-bottom|grid|custom",',
        '  "designIntent": "一句话概括设计目标",',
        '  "canvasSize": { "width": 0, "height": 0 },',
        '  "composition": {',
        '    "focalPoint": "主视觉焦点",',
        '    "readingOrder": ["先看什么","再看什么"],',
        '    "density": "low|medium|high",',
        '    "symmetry": "symmetrical|asymmetrical|mixed"',
        '  },',
        '  "elements": [',
        '    {',
        '      "type": "main-title|sub-title|body-text|cta|product-image|background|decoration|logo|tag",',
        '      "role": "headline|supporting-copy|hero-asset|cta|background|brand|decoration|badge",',
        '      "name": "元素名称",',
        '      "content": "文本内容，可为空",',
        '      "style": {',
        '        "fillColor": "#FFFFFF",',
        '        "textColor": "#111111",',
        '        "strokeColor": "#000000",',
        '        "opacity": 0-1,',
        '        "cornerRadius": 0,',
        '        "fontWeight": "light|regular|medium|bold|black",',
        '        "fontSizeRatio": 0-1,',
        '        "tracking": -1000-1000,',
        '        "leading": 1-400,',
        '        "lineHeightRatio": 0.6-3,',
        '        "effects": ["shadow","stroke","glow","blur","gradient"]',
        '      },',
        '      "position": { "x": 0-1, "y": 0-1 },',
        '      "size": { "width": 0-1, "height": 0-1 },',
        '      "relationship": { "anchors": ["相关元素"], "overlaps": ["重叠元素"], "group": "分组名" },',
        '      "visualWeight": "primary|secondary|tertiary",',
        '      "zIndex": 1',
        '    }',
        '  ],',
        '  "alignmentGroups": [{ "type": "horizontal-center|vertical-center|left-align|right-align|top-align|bottom-align", "elementIndices": [0,1] }]',
        '}'
    ].join('\n');
}

export function parseJsonObject(text: string): any | null {
    if (!text) return null;
    const first = text.indexOf('{');
    const last = text.lastIndexOf('}');
    if (first < 0 || last <= first) return null;
    try {
        return JSON.parse(text.slice(first, last + 1));
    } catch {
        return null;
    }
}

export function normalizeReferenceParseResult(raw: any): ReferenceParseResult | null {
    if (!raw || typeof raw !== 'object') return null;
    const canvasSize = normalizeCanvasSize(raw?.canvasSize);
    if (!canvasSize) return null;
    if (!Array.isArray(raw.elements) || raw.elements.length === 0) return null;

    const elements: ReferenceParseElement[] = [];
    for (const [index, el] of raw.elements.entries()) {
        const geometry = normalizeReferenceElementGeometry(el);
        if (!geometry) return null;
        elements.push({
            type: String(el?.type || 'decoration'),
            role: typeof el?.role === 'string' ? el.role : undefined,
            name: String(el?.name || `${el?.type || 'element'}_${index + 1}`),
            content: typeof el?.content === 'string' ? el.content : undefined,
            style: el?.style && typeof el.style === 'object' ? el.style : undefined,
            position: geometry.position,
            size: geometry.size,
            relationship: el?.relationship && typeof el.relationship === 'object' ? {
                anchors: Array.isArray(el.relationship.anchors) ? el.relationship.anchors.map(String) : undefined,
                overlaps: Array.isArray(el.relationship.overlaps) ? el.relationship.overlaps.map(String) : undefined,
                group: typeof el.relationship.group === 'string' ? el.relationship.group : undefined
            } : undefined,
            visualWeight: typeof el?.visualWeight === 'string' ? el.visualWeight : undefined,
            zIndex: Number.isFinite(Number(el?.zIndex)) ? Number(el.zIndex) : index + 1
        });
    }

    if (elements.length === 0) return null;

    return {
        layoutType: String(raw.layoutType || 'custom'),
        designIntent: typeof raw.designIntent === 'string' ? raw.designIntent : undefined,
        canvasSize,
        composition: raw?.composition && typeof raw.composition === 'object' ? raw.composition : undefined,
        elements,
        alignmentGroups: Array.isArray(raw.alignmentGroups) ? raw.alignmentGroups : []
    };
}

export function buildMinimalDesignRepresentation(
    parseResult: ReferenceParseResult
): MinimalDesignRepresentation | null {
    if (!parseResult || !Array.isArray(parseResult.elements) || parseResult.elements.length === 0) {
        return null;
    }
    const canvasSize = normalizeCanvasSize(parseResult.canvasSize);
    if (!canvasSize) return null;

    const elements: MinimalDesignElement[] = [];
    for (const [index, element] of parseResult.elements.entries()) {
        const geometry = normalizeReferenceElementGeometry(element);
        if (!geometry) return null;
        const sourceType = String(element.type || 'decoration');
        const role = normalizeRole(element.role);
        elements.push({
            id: `${sourceType}_${index + 1}`,
            sourceType,
            name: String(element.name || `${sourceType}_${index + 1}`),
            role,
            nodeKind: inferNodeKind(sourceType, role),
            content: element.content,
            style: normalizeStyle(element.style),
            box: {
                x: geometry.position.x,
                y: geometry.position.y,
                width: geometry.size.width,
                height: geometry.size.height
            },
            relation: element.relationship ? {
                anchors: Array.isArray(element.relationship.anchors) ? element.relationship.anchors : undefined,
                overlaps: Array.isArray(element.relationship.overlaps) ? element.relationship.overlaps : undefined,
                group: typeof element.relationship.group === 'string' ? element.relationship.group : undefined
            } : undefined,
            visualWeight:
                element.visualWeight === 'primary' ||
                element.visualWeight === 'secondary' ||
                element.visualWeight === 'tertiary'
                    ? element.visualWeight
                    : 'unknown',
            zIndex: Number.isFinite(Number(element.zIndex)) ? Number(element.zIndex) : index + 1
        });
    }

    return {
        canvas: canvasSize,
        layout: {
            layoutType: String(parseResult.layoutType || 'custom'),
            designIntent: parseResult.designIntent,
            focalPoint: parseResult.composition?.focalPoint,
            readingOrder: Array.isArray(parseResult.composition?.readingOrder)
                ? parseResult.composition?.readingOrder
                : undefined,
            density: parseResult.composition?.density,
            symmetry: parseResult.composition?.symmetry
        },
        elements,
        alignmentGroups: Array.isArray(parseResult.alignmentGroups) ? parseResult.alignmentGroups : []
    };
}
