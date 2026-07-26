import { getSkillById, SKILL_REGISTRY } from './skills/skill-declarations';
import {
    isProjectIdentityConversationIntent,
    isProjectContextMainImageDeliveryIntent,
    isProjectImageAnalysisDeliveryIntent
} from './project-image-analysis-intent';
import { isMainImageWhiteBackgroundFromSkuMaterialRequest } from './main-image-white-background-export-contract';
import {
    isPlainSkuDocumentCreateText,
    isSkuReadOnlyInspectionText,
    isSkuSourceForNonSkuDocumentTargetText,
    stripSkuDownstreamContextText
} from './sku-intent-params';
import type { SkillDeclaration } from './types/skill.types';

export interface SkillRoutingIntentMatch {
    skillId: string;
    mode?: string;
}

export interface FindSkillRoutingIntentOptions {
    excludeSkillIds?: string[];
    includeVisibilities?: SkillDeclaration['visibility'][];
    includeRouteClasses?: Array<NonNullable<SkillDeclaration['routeClass']>>;
    modelDirectExecution?: SkillDeclaration['modelDirectExecution'];
}

export const SKILL_ID_ALIASES: Record<string, string> = {
    'main-image': 'main-image-design',
    'detail-page': 'detail-page-design',
    'text-font': 'text-font-replace',
    'document': 'document-management',
    'layer': 'layer-management',
    'layers': 'layer-management',
    'sku-setup': 'sku-config',
    'agent-panel': 'agent-panel-bridge',
    'save-template': 'save-current-template',
    'template-save': 'save-current-template'
};

export function normalizeSkillId(skillId?: string): string | undefined {
    const value = String(skillId || '').trim();
    if (!value) return undefined;
    return SKILL_ID_ALIASES[value] || value;
}

export function normalizeRoutingText(text?: string): string {
    return String(text || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');
}

function compactRoutingText(text?: string): string {
    return normalizeRoutingText(text).replace(/\s+/g, '');
}

const DOCUMENT_TARGET_PATTERNS = [
    /(?:切换到|切到|切回|切换回)\s*([^\n，。!！？?]+?)\s*(?:文档|文件)?(?:并且|然后|$)/i,
    /(?:关闭|关掉)\s*([^\n，。!！？?]+?)\s*(?:文档|文件)?(?:不保存|别保存|不要保存|保存后关闭|先保存再关闭|并且|然后|$)/i
];

const DOCUMENT_SAVE_FALSE_PATTERNS = [
    /不保存/i,
    /别保存/i,
    /不要保存/i,
    /without saving/i
];

const DOCUMENT_SAVE_TRUE_PATTERNS = [
    /保存后关闭/i,
    /保存并关闭/i,
    /先保存再关闭/i,
    /save and close/i,
    /close after saving/i
];

const DOCUMENT_SAVE_FORMATS = ['psd', 'psb', 'png', 'jpg', 'jpeg', 'tif', 'tiff', 'pdf'];
const DOCUMENT_CREATE_PATTERNS = [
    /(?:新建|创建|建立|create)(?!的).{0,24}(?:文档|文件|画布|document|canvas)/i,
    /(?:文档|文件|画布|document|canvas).{0,24}(?:新建|创建|建立|create)/i
];
const DOCUMENT_LIST_PATTERNS = [
    /列出.{0,24}(?:文档|文件|document|file)/i,
    /查看.{0,24}(?:文档|文件|document|file).{0,12}(?:列表|状态|名称|路径|信息)?/i,
    /(?:有哪些|有什么).{0,12}(?:文档|文件|document|file)/i,
    /list.{0,12}(?:documents|files)/i
];
const DOCUMENT_READ_ONLY_HINT_PATTERN = /只读|read[-_\s]?only/i;
const DOCUMENT_NEGATED_MUTATION_PATTERN = /(?:不要|别|无需|不用|禁止|避免|不能|不)\s*(?:直接)?\s*(?:新建|创建|建立|create|修改|改动|写入|modify|write)/i;
const DETAIL_PAGE_DOCUMENT_CREATE_PATTERN = /(?:新建|创建|建立|create).{0,32}(?:详情页|详情|长图|detail[\s-]?page).{0,24}(?:文档|文件|画布|document|canvas)|(?:详情页|详情|长图|detail[\s-]?page).{0,24}(?:文档|文件|画布|document|canvas).{0,32}(?:新建|创建|建立|create)/i;
const LONG_DETAIL_PAGE_DOCUMENT_HINT_PATTERN = /长详情|长图|长页面|long/i;
const MAIN_IMAGE_DOCUMENT_CREATE_PATTERN = /(?:新建|创建|建立|create).{0,32}(?:主图|首图|main[\s-]?image).{0,24}(?:文档|文件|画布|document|canvas)|(?:主图|首图|main[\s-]?image).{0,24}(?:文档|文件|画布|document|canvas).{0,32}(?:新建|创建|建立|create)/i;
const SKU_DOCUMENT_CREATE_PATTERN = /(?:新建|创建|建立|create).{0,32}(?:sku).{0,24}(?:文档|文件|画布|document|canvas)|(?:sku).{0,24}(?:文档|文件|画布|document|canvas).{0,32}(?:新建|创建|建立|create)/i;
const FRESH_CREATIVE_DESIGN_DRAFT_PATTERNS = [
    /(?:从零|从0|从头|凭空).{0,24}(?:设计|做|画|创作|制作|搭|创建|建立|生成).{0,24}(?:主图|详情页|长图|海报|banner|横幅|场景图|宣传图|首图|封面|落地页)/i,
    /(?:完成|交付|产出).{0,48}(?:主图|详情页|长图|海报|banner|横幅|场景图|宣传图|首图|封面|落地页)/i,
    /可验收.{0,36}(?:主图|详情页|长图|海报|banner|横幅|场景图|宣传图|首图|封面|落地页)/i,
    /(?:主图|详情页|长图|海报|banner|横幅|场景图|宣传图|首图|封面|落地页).{0,24}(?:可验收|完成|交付|产出)/i,
    /(?:帮我|请|麻烦|需要|直接)?\s*(?:做|制作|生成|搭建|设计).{0,32}(?:主图|详情页|长图|海报|banner|横幅|场景图|宣传图|首图|封面|落地页)(?:.{0,24}(?:模板|画布|版面|视觉|设计稿|首屏|canvas|page))?/i,
    /(?:新建|创建|建立|做|制作|生成|搭建).{0,32}(?:主图|详情页|长图|海报|banner|横幅|场景图|宣传图|首图|封面|落地页).{0,24}(?:草稿|画布|版面|视觉|设计稿|首屏|临时)/i,
    /(?:新建|创建|建立|做|制作|生成|搭建).{0,32}(?:草稿|画布|版面|视觉|设计稿|首屏|临时).{0,24}(?:主图|详情页|长图|海报|banner|横幅|场景图|宣传图|首图|封面|落地页)/i,
    /(?:主图|详情页|长图|海报|banner|横幅|场景图|宣传图|首图|封面|落地页).{0,24}(?:草稿|画布|版面|视觉|设计稿)/i
];
// 上数组第 5 条（裸「做/制作/生成/设计 + 主图/详情页等」）单独命名：对主图是从零设计信号；
// 但 detail-page-design 的声明范围本身含从零路径，裸「做详情页」应归该技能而非通用循环，
// 对该技能判定时要摘掉这条 catch-all（见 isFreshCreativeDesignDraftText 的 excludeCatchAll）。
const FRESH_CREATIVE_DESIGN_CATCHALL_PATTERN = FRESH_CREATIVE_DESIGN_DRAFT_PATTERNS[4];
// 逃生舱：识别"已有模板/已打开文档"的自然说法——打开了/打开着/已打开不再强制"的"，
// 作为模板/当模板用不再要求与处理动词相邻。
const EXISTING_TEMPLATE_WORKFLOW_HINT_PATTERN = /(?:当前|这个|这份|打开了|打开的|打开着|已打开|已有|现成).{0,12}(?:模板|详情页|长图)|(?:作为|当作|当成|用作)模板|以.{0,4}为模板|(?:模板).{0,16}(?:解析|检查|填充|套用|换图|导出)|(?:解析|检查|填充|套用|换图|导出).{0,16}(?:模板)/i;
const DETAIL_PAGE_STRONG_DELIVERY_PATTERN = /(?:完成|设计|制作|生成|创建|导出|出图|排版|填充|交付).{0,36}(?:详情页|长图)|(?:详情页|长图).{0,36}(?:完成|设计|制作|生成|创建|导出|出图|排版|填充|交付)|可验收.{0,24}(?:详情页|长图)|(?:详情页|长图).{0,24}可验收/i;

function trimRoutingCapture(value?: string): string {
    return String(value || '')
        .trim()
        .replace(/^[`"'“”‘’]+|[`"'“”‘’]+$/g, '')
        .replace(/[.,，。!！？?]+$/g, '')
        .trim();
}

export function sanitizeDocumentTarget(value: string): string | undefined {
    const trimmed = trimRoutingCapture(value);
    if (!trimmed) return undefined;
    if (/^(文档|当前文档|当前打开(?:的)?文档|当前打开|当前|这个文档|该文档|这个文件|该文件|这个psd|当前这个psd|当前这个文档)$/i.test(trimmed)) {
        return undefined;
    }
    return trimmed;
}

function extractDocumentTarget(text: string): string | undefined {
    for (const pattern of DOCUMENT_TARGET_PATTERNS) {
        const match = String(text || '').match(pattern);
        const target = sanitizeDocumentTarget(String(match?.[1] || ''));
        if (target) return target;
    }
    return undefined;
}

function inferCloseSavePreference(text: string): boolean | undefined {
    if (DOCUMENT_SAVE_FALSE_PATTERNS.some((pattern) => pattern.test(text))) {
        return false;
    }
    if (DOCUMENT_SAVE_TRUE_PATTERNS.some((pattern) => pattern.test(text))) {
        return true;
    }
    return undefined;
}

function extractCreateDocumentParams(text: string): Record<string, any> {
    const params: Record<string, any> = {};
    const value = String(text || '');
    const sizeMatch = String(text || '').match(/(\d{2,5})\s*[x×*]\s*(\d{2,5})/i);
    if (sizeMatch) {
        const width = Number(sizeMatch[1]);
        const height = Number(sizeMatch[2]);
        if (Number.isFinite(width) && width > 0) params.width = width;
        if (Number.isFinite(height) && height > 0) params.height = height;
    }

    const namePatterns = [
        /(?:名字叫|名称叫|命名为|名称为|名称是|名字为|名字是|叫做|叫)\s*[:：=]?\s*([^\n，。!！？?]+)/i,
        /(?:名称|名字)\s*[:：=]\s*([^\n，。!！？?]+)/i,
        /(?:名称|名字)\s+([^\n，。!！？?]+)/i
    ];
    const nameMatch = namePatterns.map((pattern) => String(text || '').match(pattern)).find(Boolean);
    const name = trimRoutingCapture(String(nameMatch?.[1] || '')).replace(/\s*的文档$/i, '').trim();
    if (name) {
        params.name = name;
    }

    const presetMatch = String(text || '').match(/(?:预设|preset)\s*([^\n，。!！？?]+)/i);
    const preset = trimRoutingCapture(String(presetMatch?.[1] || ''));
    if (preset) {
        params.preset = preset;
    }

    if (!params.preset && DETAIL_PAGE_DOCUMENT_CREATE_PATTERN.test(value)) {
        const longDetailPage = LONG_DETAIL_PAGE_DOCUMENT_HINT_PATTERN.test(value);
        params.preset = longDetailPage ? 'detail-page-large' : 'detail-page';
        if (!params.name) params.name = longDetailPage ? '长详情页' : '详情页';
    }

    if (!params.preset && MAIN_IMAGE_DOCUMENT_CREATE_PATTERN.test(value)) {
        params.preset = 'main-image';
        if (!params.name) params.name = '主图';
    }

    if (!params.name && SKU_DOCUMENT_CREATE_PATTERN.test(value)) {
        params.name = 'SKU';
    }

    return params;
}

function isDocumentCreateIntentText(text: string): boolean {
    const value = String(text || '');
    const hasCreateSignal = DOCUMENT_CREATE_PATTERNS.some((pattern) => pattern.test(value));
    if (!hasCreateSignal) return false;

    const hasListSignal = DOCUMENT_LIST_PATTERNS.some((pattern) => pattern.test(value));
    const hasReadOnlyHint = DOCUMENT_READ_ONLY_HINT_PATTERN.test(value);
    const hasNegatedMutation = DOCUMENT_NEGATED_MUTATION_PATTERN.test(value);
    if (hasNegatedMutation && (hasListSignal || hasReadOnlyHint)) return false;

    return true;
}

function isFreshCreativeDesignDraftText(text: string, options?: { excludeCatchAll?: boolean }): boolean {
    const value = String(text || '').trim();
    if (!value) return false;
    if (EXISTING_TEMPLATE_WORKFLOW_HINT_PATTERN.test(value)) return false;
    return FRESH_CREATIVE_DESIGN_DRAFT_PATTERNS.some((pattern) => {
        if (options?.excludeCatchAll && pattern === FRESH_CREATIVE_DESIGN_CATCHALL_PATTERN) return false;
        return pattern.test(value);
    });
}

function normalizeSaveFormat(format?: string): string | undefined {
    const value = String(format || '').trim().toLowerCase();
    if (!value) return undefined;
    if (value === 'tif') return 'tiff';
    if (DOCUMENT_SAVE_FORMATS.includes(value)) return value;
    return undefined;
}

function inferDocumentSaveFormat(text: string): string | undefined {
    const value = String(text || '');
    const extensionMatch = value.match(/\.(psd|psb|png|jpe?g|tiff?|pdf)\b/i);
    const fromExtension = normalizeSaveFormat(extensionMatch?.[1]);
    if (fromExtension) return fromExtension;

    if (/\bpsb\b/i.test(value) || /大型文档/i.test(value)) return 'psb';
    if (/\bpsd\b/i.test(value) || /PSD/i.test(value)) return 'psd';
    if (/\bpng\b/i.test(value)) return 'png';
    if (/\b(?:jpg|jpeg)\b/i.test(value)) return 'jpg';
    if (/\b(?:tif|tiff)\b/i.test(value)) return 'tiff';
    if (/\bpdf\b/i.test(value)) return 'pdf';
    return undefined;
}

function extractExplicitSavePath(text: string): string | undefined {
    const value = String(text || '');
    const quotedMatch = value.match(/["“”'‘’]([^"“”'‘’\n]+\.(?:psd|psb|png|jpe?g|tiff?|pdf))["“”'‘’]/i);
    const quotedPath = trimRoutingCapture(String(quotedMatch?.[1] || ''));
    if (quotedPath) return quotedPath;

    const windowsPathMatch = value.match(/[a-zA-Z]:[\\/][^\n，。!！？?]+?\.(?:psd|psb|png|jpe?g|tiff?|pdf)/i);
    const windowsPath = trimRoutingCapture(String(windowsPathMatch?.[0] || ''));
    if (windowsPath) return windowsPath;

    return undefined;
}

export function extractRequestedOutputPathParams(text: string): Record<string, string> {
    const value = String(text || '').trim();
    if (!/(?:另存为|保存为|存为|保存到|输出到|导出到|save\s+as|output\s+to|export\s+to)/i.test(value)) {
        return {};
    }

    const explicitPath = extractExplicitSavePath(value);
    const cuePathMatch = value.match(
        /(?:另存为|保存为|存为|保存到|输出到|导出到|save\s+as|output\s+to|export\s+to)\s*[:：]?\s*[“"'‘’]?([^\n，。!！?？；;]+?\.(?:psd|psb|png|jpe?g|tiff?|pdf))[”"'‘’]?\s*(?:$|[，。!！?？；;])/i
    );
    const requestedPath = trimRoutingCapture(
        explicitPath || String(cuePathMatch?.[1] || '')
    );
    if (!requestedPath) return {};

    if (/^(?:[a-zA-Z]:[\\/]|\\\\|\/)/.test(requestedPath)) {
        return { outputPath: requestedPath };
    }

    return { outputRelativePath: requestedPath };
}

function extractSaveDocumentParams(text: string): Record<string, any> {
    const params: Record<string, any> = {};
    const value = String(text || '');
    const format = inferDocumentSaveFormat(text);
    if (format) {
        params.format = format;
    }

    const path = extractExplicitSavePath(text);
    if (path) {
        params.path = path;
        params.saveAs = true;
        const pathFormat = inferDocumentSaveFormat(path);
        if (pathFormat) params.format = pathFormat;
    } else if (/保存到项目|项目(?:的)?\s*(?:PSD|psd)|另存|导出|export|save as/i.test(value)) {
        params.saveAs = true;
    }

    if (/项目(?:的)?\s*(?:PSD|psd)|(?:PSD|psd)\s*(?:中|目录|文件夹)/i.test(value)) {
        params.projectSubdir = 'PSD';
        params.saveAs = true;
        if (!params.format) params.format = 'psd';
    }

    return params;
}

export function extractDocumentManagementRoutingParams(
    text: string,
    action?: string
): Record<string, any> {
    const normalizedAction = String(action || '').trim().toLowerCase();
    if (!normalizedAction) return {};

    const params: Record<string, any> = { action: normalizedAction };

    if (normalizedAction === 'switch' || normalizedAction === 'close') {
        const documentName = extractDocumentTarget(text);
        if (documentName) {
            params.documentName = documentName;
        }
    }

    if (normalizedAction === 'close') {
        const save = inferCloseSavePreference(text);
        if (typeof save === 'boolean') {
            params.save = save;
        }
    }

    if (normalizedAction === 'save') {
        Object.assign(params, extractSaveDocumentParams(text));
    }

    if (normalizedAction === 'create') {
        Object.assign(params, extractCreateDocumentParams(text));
    }

    return params;
}

export function textContainsRoutingSignal(text: string, signal: string): boolean {
    const rawSignal = String(signal || '').trim();
    if (rawSignal.startsWith('regex:')) {
        const source = rawSignal.slice('regex:'.length).trim();
        if (!source) return false;
        try {
            return new RegExp(source, 'i').test(normalizeRoutingText(text));
        } catch {
            return false;
        }
    }

    const normalizedSignal = normalizeRoutingText(signal);
    if (!normalizedSignal) return false;

    const normalizedText = normalizeRoutingText(text);
    const compactText = compactRoutingText(text);
    const compactSignal = compactRoutingText(signal);

    return normalizedText.includes(normalizedSignal)
        || (!!compactSignal && compactText.includes(compactSignal));
}

export function textContainsAnyRoutingSignal(text: string, signals?: string[]): boolean {
    if (!Array.isArray(signals) || signals.length === 0) return false;
    return signals.some((signal) => textContainsRoutingSignal(text, signal));
}

export function textMatchesAllRoutingSignalGroups(text: string, signalGroups?: string[][]): boolean {
    if (!Array.isArray(signalGroups) || signalGroups.length === 0) return false;

    return signalGroups.every((group) => (
        Array.isArray(group)
        && group.length > 0
        && textContainsAnyRoutingSignal(text, group)
    ));
}

export function isAmbiguousSkuSourceExportText(text: string): boolean {
    const normalized = normalizeRoutingText(text);
    if (!normalized || !/sku/i.test(normalized)) return false;

    const hasSkuSourceWording = /(sku\s*素材|sku\s*源文件|sku\s*来源|使用\s*sku|用\s*sku|sku.{0,8}(素材|源文件|来源)|素材.{0,8}sku)/i.test(normalized);
    if (!hasSkuSourceWording) return false;

    const hasExportOrUseAction = /(导出|输出|保存|出图|使用|用)/.test(normalized);
    if (!hasExportOrUseAction) return false;

    const hasExplicitSkuDeliverable = /(组合图|自选备注|备注图|批量配色|批量出图|批量生成|双装|单双装|\d{1,2}\s*双|做\s*sku|制作\s*sku|生成\s*sku|sku\s*组合|sku\s*自选)/i.test(normalized);
    if (hasExplicitSkuDeliverable) return false;

    const hasExplicitNonSkuTarget = /(白底图|自底图|白底|主图|点击图|转化图|详情页|png|jpg|jpeg|psd|psb|文档)/i.test(normalized);
    return !hasExplicitNonSkuTarget;
}

export function matchesSkillRoutingIntent(skillId: string, text: string): boolean {
    const normalizedSkillId = normalizeSkillId(skillId);
    if (normalizedSkillId === 'main-image-design' && isProjectContextMainImageDeliveryIntent(text)) {
        return true;
    }
    if (
        normalizedSkillId === 'main-image-design'
        && isMainImageWhiteBackgroundFromSkuMaterialRequest({ userIntent: text })
    ) {
        return true;
    }
    const isMainImageDesignSkill = normalizedSkillId === 'main-image-design';
    const isDetailPageDesignSkill = normalizedSkillId === 'detail-page-design';
    if (
        (isMainImageDesignSkill || isDetailPageDesignSkill)
        && isFreshCreativeDesignDraftText(text, {
            // detail-page-design 的声明范围含从零路径：裸「做详情页」归该技能；
            // 明确的从零/交付措辞仍按从零设计排除。main-image-design 行为不变。
            excludeCatchAll: isDetailPageDesignSkill
        })
    ) {
        return false;
    }
    if (normalizedSkillId === 'document-management' && isFreshCreativeDesignDraftText(text)) {
        return false;
    }
    if (normalizedSkillId === 'document-management' && isDocumentCreateIntentText(text)) {
        return true;
    }
    if (normalizedSkillId === 'document-management' && DOCUMENT_LIST_PATTERNS.some((pattern) => pattern.test(text))) {
        return true;
    }
    if (normalizedSkillId === 'project-image-analysis' && isProjectIdentityConversationIntent(text)) {
        return false;
    }
    if (normalizedSkillId === 'project-image-analysis' && isProjectImageAnalysisDeliveryIntent(text)) {
        return false;
    }
    if (normalizedSkillId === 'sku-batch' && isSkuReadOnlyInspectionText(text)) {
        return false;
    }
    if (normalizedSkillId === 'sku-batch' && isPlainSkuDocumentCreateText(text)) {
        return false;
    }
    if (
        (normalizedSkillId === 'sku-batch' || normalizedSkillId === 'sku-color-card')
        && isSkuSourceForNonSkuDocumentTargetText(text)
    ) {
        return false;
    }
    if (normalizedSkillId === 'sku-batch' && isAmbiguousSkuSourceExportText(text)) {
        return false;
    }

    const skill = getSkillById(skillId);
    const routing = skill?.routing;
    const hasGroupedSignals = Array.isArray(routing?.intentSignalGroups) && routing.intentSignalGroups.length > 0;
    const hasIntentSignals = Array.isArray(routing?.intentSignals) && routing.intentSignals.length > 0;

    if (!hasGroupedSignals && !hasIntentSignals) return false;

    if (hasGroupedSignals) {
        if (!textMatchesAllRoutingSignalGroups(text, routing?.intentSignalGroups)) {
            return false;
        }
    } else if (!textContainsAnyRoutingSignal(text, routing?.intentSignals)) {
        return false;
    }

    const negativeSignalText = normalizedSkillId === 'sku-batch'
        ? stripSkuDownstreamContextText(text)
        : text;
    if (textContainsAnyRoutingSignal(negativeSignalText, routing.negativeSignals)) {
        return false;
    }

    return true;
}

export function findSkillRoutingIntent(
    text: string,
    options: FindSkillRoutingIntentOptions = {}
): SkillRoutingIntentMatch | undefined {
    return findSkillRoutingIntents(text, options)[0];
}

/**
 * 返回所有由 Skill 声明自身路由元数据命中的候选。
 *
 * 该函数只做能力归属识别，不执行 Skill、不授予工具权限。调用方需要在存在多个
 * 候选时继续交给模型消歧，不能沿用注册顺序把第一个候选伪装成唯一结论。
 */
export function findSkillRoutingIntents(
    text: string,
    options: FindSkillRoutingIntentOptions = {}
): SkillRoutingIntentMatch[] {
    const includeVisibilities = new Set(options.includeVisibilities || ['user-facing']);
    const includeRouteClasses = options.includeRouteClasses
        ? new Set(options.includeRouteClasses)
        : undefined;
    const excludeSkillIds = new Set(
        (options.excludeSkillIds || [])
            .map((skillId) => normalizeSkillId(skillId))
            .filter((skillId): skillId is string => Boolean(skillId))
    );

    const matches: SkillRoutingIntentMatch[] = [];
    for (const skill of SKILL_REGISTRY) {
        const skillId = normalizeSkillId(skill.id);
        if (!skillId || excludeSkillIds.has(skillId)) continue;
        if (!includeVisibilities.has(skill.visibility)) continue;
        if (includeRouteClasses && (!skill.routeClass || !includeRouteClasses.has(skill.routeClass))) continue;
        if (options.modelDirectExecution !== undefined
            && skill.modelDirectExecution !== options.modelDirectExecution) continue;
        if (!matchesSkillRoutingIntent(skillId, text)) continue;

        matches.push({
            skillId,
            mode: resolveSkillRoutingMode(skillId, text)
        });
    }

    return matches;
}

/**
 * 只有一个声明候选时才返回能力归属；零个或多个都保持未选择。
 * 这是 Harness 的可插拔能力解析，不是业务流程路由：新增 Skill 只需维护自己的
 * declaration，Agent 核心不出现品类名称或专属关键词。
 */
export function findUniqueSkillRoutingIntent(
    text: string,
    options: FindSkillRoutingIntentOptions = {}
): SkillRoutingIntentMatch | undefined {
    const matches = findSkillRoutingIntents(text, options);
    return matches.length === 1 ? matches[0] : undefined;
}

export function resolveSkillRoutingMode(skillId: string, text: string): string | undefined {
    const normalizedSkillId = normalizeSkillId(skillId);
    if (normalizedSkillId === 'document-management' && isDocumentCreateIntentText(text)) {
        return 'create';
    }
    if (normalizedSkillId === 'document-management' && DOCUMENT_LIST_PATTERNS.some((pattern) => pattern.test(text))) {
        return 'list';
    }
    if (normalizedSkillId === 'detail-page-design' && DETAIL_PAGE_STRONG_DELIVERY_PATTERN.test(text)) {
        return 'execute';
    }

    const skill = getSkillById(skillId);
    const modeSignals = skill?.routing?.modeSignals;
    if (!modeSignals || typeof modeSignals !== 'object') return undefined;

    for (const [mode, signals] of Object.entries(modeSignals)) {
        if (textContainsAnyRoutingSignal(text, signals)) {
            return mode;
        }
    }

    return undefined;
}
