import {
    normalizeDesignDimensionSpec,
    type DesignDimensionSpec
} from './design-dimension-spec';
import type { RuntimeDesignWorkMode } from './agent-runtime-v5/contracts';
import { resolveReferenceReplicationOutputIntent } from './reference-replication-output-intent';

export type DesignDocumentRole = 'detailPage' | 'sku' | 'mainImage' | 'poster' | 'banner' | 'unknown';

export type CurrentDocumentUseMode =
    | 'none'
    | 'reuse'
    | 'observe_only'
    | 'protected'
    | 'separate_target';

export interface DesignDocumentRoleContext {
    targetRole: DesignDocumentRole;
    currentRole: DesignDocumentRole;
    currentDocumentName: string;
    currentDocumentUse: CurrentDocumentUseMode;
    canReuseCurrentDocument: boolean;
    shouldObserveCurrentDocument: boolean;
    agentInstruction: string;
}

export interface CreateDocumentTargetBoundaryDecision {
    allowed: boolean;
    code: 'create_document_target_allowed'
        | 'create_document_would_fork_existing_target'
        | 'create_document_target_unresolved';
    message: string;
    nextRequiredTool?: 'listDocuments';
}

export function isCreateDocumentOperation(
    toolName: string,
    params: Record<string, any> = {}
): boolean {
    if (toolName === 'createDocument') return true;
    return toolName === 'document-management'
        && String(params.action || '').trim().toLowerCase() === 'create';
}

export interface UserExplicitDocumentOverrides {
    name?: string;
    width?: number;
    height?: number;
}

export interface DesignDocumentNormalizationOptions {
    canonicalName?: boolean;
    canonicalDimensions?: boolean;
    dimensionSpec?: Partial<DesignDimensionSpec> | null;
    userOverrides?: UserExplicitDocumentOverrides;
}

function normalizePositiveDimension(value: unknown): number | undefined {
    const dimension = Number(value);
    if (!Number.isFinite(dimension) || dimension <= 0) return undefined;
    return Math.round(dimension);
}

/**
 * 只提取用户在本轮文本里明确声明的文档参数。
 * 这些值的优先级高于模型生成参数、角色默认值和用户设置中的默认规范。
 */
export function extractUserExplicitDocumentOverrides(userInput: unknown): UserExplicitDocumentOverrides {
    const text = String(userInput || '').trim();
    if (!text) return {};

    const output: UserExplicitDocumentOverrides = {};
    const dimensionPair = text.match(/(?:尺寸(?:是|为|[:：])?\s*)?(\d{2,5})\s*[x×*]\s*(\d{2,5})(?:\s*(?:px|像素))?/i);
    if (dimensionPair) {
        output.width = normalizePositiveDimension(dimensionPair[1]);
        output.height = normalizePositiveDimension(dimensionPair[2]);
    }

    const explicitWidth = text.match(/(?:画布|文档|图片|图像)?(?:宽度|宽)\s*(?:是|为|[:：])?\s*(\d{2,5})(?:\s*(?:px|像素))?/i);
    const explicitHeight = text.match(/(?:画布|文档|图片|图像)?(?:高度|高)\s*(?:是|为|[:：])?\s*(\d{2,5})(?:\s*(?:px|像素))?/i);
    if (explicitWidth) output.width = normalizePositiveDimension(explicitWidth[1]);
    if (explicitHeight) output.height = normalizePositiveDimension(explicitHeight[1]);

    const quotedName = text.match(/(?:名称|名字|命名)(?:必须)?(?:是|为|叫)?\s*[「『“\"']([^」』”\"'\r\n]{1,80})[」』”\"']/i);
    const plainName = text.match(/(?:名称|名字)(?:必须)?(?:是|为|叫)\s*([^\s，。；,;]{1,80})/i);
    const name = String(quotedName?.[1] || plainName?.[1] || '').trim();
    if (name) output.name = name;

    return output;
}

function hasExplicitCurrentDocumentProtection(userInput: string): boolean {
    const text = String(userInput || '').replace(/\s+/g, '');
    if (!text) return false;
    const currentDocumentNoun = '(?:文档|PSD|PSB|文件|图片|图像|画布)';
    return new RegExp(`(?:不要|别|无需|不必)(?:再)?(?:改动|修改|编辑|覆盖|写入|操作|处理)(?:我)?(?:现在|当前|已经|已)?(?:打开的?)?(?:这个)?${currentDocumentNoun}`, 'i').test(text)
        || new RegExp(`(?:保留|保护)(?:我)?(?:现在|当前|已经|已)?(?:打开的?)?(?:这个)?${currentDocumentNoun}(?:不变)?`, 'i').test(text)
        || new RegExp(`(?:我)?(?:现在|当前|已经|已)?(?:打开的?)?(?:这个)?${currentDocumentNoun}(?:保持不变|不要动|别动)`, 'i').test(text)
        || /do\s*not(?:modify|edit|overwrite)(?:the)?(?:current|open)(?:document|file)/i.test(text);
}

function hasExplicitCurrentDocumentReuse(userInput: string): boolean {
    const text = String(userInput || '').replace(/\s+/g, '');
    if (!text) return false;
    const currentDocumentNoun = '(?:文档|PSD|PSB|文件|图片|图像|画布)';
    return new RegExp(`(?:修改|编辑|处理|继续设计|继续处理)(?:我)?(?:现在|当前|已经|已)?(?:打开的?)?(?:这个)?${currentDocumentNoun}`, 'i').test(text)
        || new RegExp(`(?:就在|直接在|基于)(?:我)?(?:现在|当前|已经|已)?(?:打开的?)?(?:这个)?${currentDocumentNoun}(?:上|里|中)?(?:修改|编辑|处理|设计|继续)?`, 'i').test(text)
        || /(?:modify|edit|continuein|workin)(?:the)?(?:current|open)(?:document|file)/i.test(text);
}

function hasExplicitCurrentSelectionReuse(userInput: string): boolean {
    const text = String(userInput || '').replace(/\s+/g, '');
    if (!text) return false;
    const editVerb = '(?:修改|编辑|替换|调整|优化|改写|重写|处理|改成|换成)';
    const selectedTarget = '(?:(?:当前|现在|刚才|已)?(?:选中|选择|选定)(?:的)?(?:图层组|图层|文字|文本|文案|标题|内容|元素|对象|区域|模块))';
    return new RegExp(`${editVerb}.{0,24}${selectedTarget}`, 'i').test(text)
        || new RegExp(`${selectedTarget}.{0,24}${editVerb}`, 'i').test(text)
        || /(?:modify|edit|replace|rewrite|adjust)(?:the)?(?:current|currently)?selected(?:layer|text|copy|element)/i.test(text);
}

function resolveCurrentDocumentUseMode(input: {
    userInput: string;
    currentDocumentName: string;
    targetRole: DesignDocumentRole;
    currentRole: DesignDocumentRole;
    workMode?: RuntimeDesignWorkMode;
}): CurrentDocumentUseMode {
    if (!input.currentDocumentName) return 'none';
    if (hasExplicitCurrentDocumentProtection(input.userInput)) return 'protected';
    if (input.workMode === 'create_new') return 'separate_target';
    if (input.workMode === 'edit_existing'
        || input.workMode === 'template_fill'
        || input.workMode === 'export_only') {
        return 'reuse';
    }
    if (input.workMode === 'analyze_only') return 'observe_only';
    if (hasExplicitCurrentSelectionReuse(input.userInput)) return 'reuse';

    const rolesConflict = input.targetRole !== 'unknown'
        && input.currentRole !== 'unknown'
        && input.targetRole !== input.currentRole;
    if (rolesConflict) return 'separate_target';
    if (hasExplicitCurrentDocumentReuse(input.userInput)) return 'reuse';

    const rolesMatch = input.targetRole !== 'unknown'
        && input.currentRole !== 'unknown'
        && input.targetRole === input.currentRole;
    return rolesMatch ? 'reuse' : 'observe_only';
}

function buildDocumentRoleInstruction(input: {
    targetRole: DesignDocumentRole;
    currentRole: DesignDocumentRole;
    currentDocumentName: string;
    currentDocumentUse: CurrentDocumentUseMode;
}): string {
    const targetLabel = formatDesignDocumentRole(input.targetRole);
    const currentLabel = formatDesignDocumentRole(input.currentRole);

    if (input.currentDocumentUse === 'protected') {
        return `用户明确要求保护当前打开的 ${currentLabel} 文档「${input.currentDocumentName}」。不要自动分析或写入这个文档；请先创建或切换到另一个目标文档，再执行任何修改、保存或导出。`;
    }
    if (input.currentDocumentUse === 'separate_target') {
        return `目标是${targetLabel}文档，当前打开的是 ${currentLabel} 文档「${input.currentDocumentName}」；不要把当前文档当作${targetLabel}模板或素材来源。请创建或切换到名称属于${targetLabel}的文档后再写入。`;
    }
    if (input.currentDocumentUse === 'reuse') {
        if (input.targetRole === 'unknown') {
            return `用户明确指定当前打开的 ${currentLabel} 文档「${input.currentDocumentName}」或其中当前选中的内容为写入目标。请继续在这个文档中定位并修改，不要另建文档。`;
        }
        return `目标是${targetLabel}文档，当前打开的是 ${currentLabel} 文档「${input.currentDocumentName}」，可以作为当前目标文档继续处理。`;
    }
    if (input.currentDocumentUse === 'observe_only') {
        return `当前打开的是 ${currentLabel} 文档「${input.currentDocumentName}」。它只能作为只读上下文；除非用户明确指定它就是写入目标，否则不要在该文档上修改、保存或导出。`;
    }
    if (input.targetRole === 'unknown') {
        return '当前没有可识别的目标文档角色。请先根据用户任务判断要处理的是详情页、SKU、主图还是其他设计产物。';
    }
    return `目标是${targetLabel}文档；当前没有打开文档，请创建名称属于${targetLabel}的文档后再写入。`;
}

export function inferDesignDocumentRoleFromName(documentName: string): DesignDocumentRole {
    const name = String(documentName || '').trim().toLowerCase();
    if (!name) return 'unknown';

    if (/详情页|商品详情|detail\s*page|detail-page|product\s*detail/.test(name)) {
        return 'detailPage';
    }

    if (/(^|[^a-z0-9])sku([^a-z0-9]|$)/.test(name)) {
        return 'sku';
    }

    if (/主图|点击图|转化图|main\s*image|main-image|hero\s*image/.test(name)) {
        return 'mainImage';
    }

    if (/海报|宣传图|活动图|poster/.test(name)) {
        return 'poster';
    }

    if (/banner|横幅|店铺头图|活动横幅/.test(name)) {
        return 'banner';
    }

    return 'unknown';
}

export function inferDesignDocumentRoleFromTaskText(userInput: string): DesignDocumentRole {
    const text = String(userInput || '').trim();
    if (!text) return 'unknown';

    // 参考来源不是交付物身份。「参考详情页做海报」必须识别为海报目标，
    // 「参考海报做详情页」则必须识别为详情页目标；统一复用输出意图契约，
    // 避免这里另写一套“最后一个关键词”规则。
    if (/参考|复刻|仿照|照着|还原|复现|同款|临摹/i.test(text)) {
        const referenceOutput = resolveReferenceReplicationOutputIntent({ userIntent: text });
        if (referenceOutput.artifactKind !== 'generic') {
            return referenceOutput.documentRole;
        }
    }

    if (/海报|宣传图|活动图|poster/i.test(text)) {
        return 'poster';
    }

    if (/banner|横幅|店铺头图|活动横幅/i.test(text)) {
        return 'banner';
    }

    if (/详情页|商品详情|产品详情|详情长图|长详情|detail\s*page/i.test(text)) {
        return 'detailPage';
    }

    if (/(^|[^a-z0-9])sku([^a-z0-9]|$)|色卡|组合图|规格图|自选备注|备注图/i.test(text)) {
        return 'sku';
    }

    if (/主图|点击图|转化图|白底图|main\s*image|hero\s*image/i.test(text)) {
        return 'mainImage';
    }

    return 'unknown';
}

export function isKnownNonDetailPageRole(role: DesignDocumentRole): boolean {
    return role === 'sku' || role === 'mainImage' || role === 'poster' || role === 'banner';
}

export function formatDesignDocumentRole(role: DesignDocumentRole): string {
    if (role === 'detailPage') return '详情页';
    if (role === 'sku') return 'SKU';
    if (role === 'mainImage') return '主图';
    if (role === 'poster') return '海报';
    if (role === 'banner') return '横幅';
    return '未知';
}

export function buildDesignDocumentRoleContext(input: {
    userInput?: unknown;
    currentDocumentName?: unknown;
    workMode?: RuntimeDesignWorkMode;
}): DesignDocumentRoleContext {
    const userInput = String(input.userInput || '');
    const currentDocumentName = String(input.currentDocumentName || '').trim();
    const targetRole = inferDesignDocumentRoleFromTaskText(userInput);
    const currentRole = inferDesignDocumentRoleFromName(currentDocumentName);
    const currentDocumentUse = resolveCurrentDocumentUseMode({
        userInput,
        currentDocumentName,
        targetRole,
        currentRole,
        workMode: input.workMode
    });
    const canReuseCurrentDocument = currentDocumentUse === 'reuse';
    const shouldObserveCurrentDocument = currentDocumentUse === 'reuse'
        || currentDocumentUse === 'observe_only';
    const agentInstruction = buildDocumentRoleInstruction({
        targetRole,
        currentRole,
        currentDocumentName,
        currentDocumentUse
    });

    return {
        targetRole,
        currentRole,
        currentDocumentName,
        currentDocumentUse,
        canReuseCurrentDocument,
        shouldObserveCurrentDocument,
        agentInstruction
    };
}

/**
 * 新建文档只能建立一个尚未绑定的交付目标，不能用来逃避既有目标上的定位或写入失败。
 * 这里消费已经解析好的文档角色，不读取模型提供的“确认”布尔值。
 */
export function evaluateCreateDocumentTargetBoundary(
    context: DesignDocumentRoleContext
): CreateDocumentTargetBoundaryDecision {
    if (context.currentDocumentUse === 'reuse') {
        return {
            allowed: false,
            code: 'create_document_would_fork_existing_target',
            message: `本任务的写入目标已经绑定到当前文档「${context.currentDocumentName || '未命名文档'}」。新建文档会把同一任务分叉到错误画布，已阻止；请继续定位并修改原目标。`
        };
    }
    if (context.currentDocumentUse === 'observe_only' && context.targetRole === 'unknown') {
        return {
            allowed: false,
            code: 'create_document_target_unresolved',
            message: `当前文档「${context.currentDocumentName || '未命名文档'}」与本轮写入目标尚未完成绑定，不能用新建文档代替目标确认。请先读取已打开文档并明确要处理的目标。`,
            nextRequiredTool: 'listDocuments'
        };
    }
    return {
        allowed: true,
        code: 'create_document_target_allowed',
        message: '当前任务允许建立独立目标文档。'
    };
}

export function normalizeCreateDocumentParamsForDesignRole(
    role: DesignDocumentRole,
    params: Record<string, any> = {},
    options: DesignDocumentNormalizationOptions = {}
): Record<string, any> {
    const next = { ...(params || {}) };
    const dimensionSpec = normalizeDesignDimensionSpec(options.dimensionSpec);
    const userOverrides = options.userOverrides || {};
    if (role === 'detailPage') {
        if (userOverrides.name) next.name = userOverrides.name;
        else if (options.canonicalName || !String(next.name || '').trim()) next.name = '详情页';
        if (!String(next.preset || '').trim()) next.preset = 'detail-page';
        if (userOverrides.width) next.width = userOverrides.width;
        else if (options.canonicalDimensions) next.width = dimensionSpec.detailPage.baseWidth;
        if (userOverrides.height) next.height = userOverrides.height;
    } else if (role === 'sku') {
        if (userOverrides.name) next.name = userOverrides.name;
        else if (options.canonicalName || !String(next.name || '').trim()) next.name = 'SKU';
        if (userOverrides.width) next.width = userOverrides.width;
        if (userOverrides.height) next.height = userOverrides.height;
    } else if (role === 'mainImage') {
        if (userOverrides.name) next.name = userOverrides.name;
        else if (options.canonicalName || !String(next.name || '').trim()) next.name = '主图';
        if (!String(next.preset || '').trim()) next.preset = 'main-image';
        if (userOverrides.width) next.width = userOverrides.width;
        else if (options.canonicalDimensions) next.width = dimensionSpec.mainImage.width;
        if (userOverrides.height) next.height = userOverrides.height;
        else if (options.canonicalDimensions) next.height = dimensionSpec.mainImage.height;
    } else if (role === 'poster' || role === 'banner') {
        if (userOverrides.name) next.name = userOverrides.name;
        else if (options.canonicalName || !String(next.name || '').trim()) {
            next.name = role === 'poster' ? '海报' : '横幅';
        }
        if (userOverrides.width) next.width = userOverrides.width;
        if (userOverrides.height) next.height = userOverrides.height;
    }
    return next;
}

export function normalizeLayoutParamsForDesignRole(
    role: DesignDocumentRole,
    params: Record<string, any> = {},
    options: DesignDocumentNormalizationOptions = {}
): Record<string, any> {
    const next = { ...(params || {}) };
    const dimensionSpec = normalizeDesignDimensionSpec(options.dimensionSpec);
    const userOverrides = options.userOverrides || {};
    const canvas = next.canvas && typeof next.canvas === 'object' && !Array.isArray(next.canvas)
        ? { ...next.canvas }
        : {};
    if (role === 'detailPage' && options.canonicalDimensions) {
        canvas.width = userOverrides.width || dimensionSpec.detailPage.baseWidth;
        if (userOverrides.height) canvas.height = userOverrides.height;
    } else if (role === 'mainImage' && options.canonicalDimensions) {
        canvas.width = userOverrides.width || dimensionSpec.mainImage.width;
        canvas.height = userOverrides.height || dimensionSpec.mainImage.height;
    } else {
        if (userOverrides.width) canvas.width = userOverrides.width;
        if (userOverrides.height) canvas.height = userOverrides.height;
    }
    if (Object.keys(canvas).length > 0) {
        next.canvas = canvas;
    }
    return next;
}
