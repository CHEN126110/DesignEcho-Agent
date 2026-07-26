import { getUserFacingSkills } from '../../../shared/skills/skill-declarations';
import {
    buildAgentResponseKnowledgeBundle,
    renderAgentResponseKnowledgePromptSection
} from '../../../shared/agent-response-knowledge';
import { AGENT_RESPONSE_PRESENTATION_PROMPT } from '../../../shared/agent-response-presentation';
import { buildAgentOperatingProfilePromptSection } from '../../../shared/agent-runtime-v5/agent-operating-profile';
import {
    OPERATING_CONTEXT_RUNTIME_ITEM_ID,
    buildOperatingContextRuntimeItem,
    resolveOperatingPhotoshopConnection,
    resolveOperatingPhotoshopDocumentPresence
} from '../../../shared/agent-runtime-v5/operating-context-snapshot';
import {
    compileRuntimeContext,
    type RuntimeContextItem
} from '../../../shared/agent-runtime-v5/runtime-context-compiler';
import { compileAgentConversationHistoryData } from '../../../shared/agent-conversation-context';
import {
    buildAgentPreferenceFeedbackMessages,
    normalizeAgentPreferenceFeedbackDecision,
    shouldAttemptPreferenceFeedbackCapture
} from '../../../shared/agent-preference-feedback';
import {
    looksLikeCannedCapabilityMenu,
    looksLikeFormulaicCapabilityExplainer,
    sanitizeUserVisibleAssistantBodyText
} from '../../../shared/chat-response-cleaner';
import { buildConversationalUnavailableMessage } from '../../../shared/conversational-unavailable-message';
import {
    buildAgentIntentControlPlaneDecision,
    isAgentSkillCapabilityQuestion,
    type AgentIntentControlPlaneDecision
} from '../../../shared/agent-intent-control-plane';
import { useAppStore } from '../../stores/app.store';
import { getMemoryService } from '../memory.service';
import {
    resolveAgentProjectMemoryScope,
    type AgentContext,
    type LightweightIntent,
    type ProcessOptions
} from './types';
import { isAgentMattingPaused } from './routing';
import type { ClarificationFollowupContext } from './clarification-followup';
import type { SkillDeclaration } from '../../../shared/types/skill.types';

function parseJsonBlock(text: string): any | null {
    const trimmed = String(text || '').trim();
    if (!trimmed) return null;

    const fenced = trimmed.match(/```json\s*([\s\S]*?)```/i);
    const candidate = fenced ? fenced[1].trim() : trimmed;

    try {
        return JSON.parse(candidate);
    } catch {
        const start = candidate.indexOf('{');
        const end = candidate.lastIndexOf('}');
        if (start >= 0 && end > start) {
            try {
                return JSON.parse(candidate.slice(start, end + 1));
            } catch {
                return null;
            }
        }
        return null;
    }
}

const CONVERSATIONAL_JSON_TEXT_KEYS = [
    'directResponse',
    'response',
    'reply',
    'answer',
    'message',
    'content',
    'text'
];

function hasConversationalJsonToolIntent(value: unknown): boolean {
    if (!value || typeof value !== 'object') return false;
    if (Array.isArray(value)) {
        return value.some((item) => hasConversationalJsonToolIntent(item));
    }

    for (const [rawKey, rawChild] of Object.entries(value as Record<string, unknown>)) {
        const key = rawKey.toLowerCase().replace(/[-_\s]/g, '');
        if ([
            'toolcall',
            'toolcalls',
            'functioncall',
            'function',
            'parameters',
            'arguments'
        ].includes(key)) {
            return true;
        }
        if (hasConversationalJsonToolIntent(rawChild)) return true;
    }
    return false;
}

function hasConversationalJsonInternalRoute(value: unknown): boolean {
    if (!value || typeof value !== 'object') return false;
    if (Array.isArray(value)) {
        return value.some((item) => hasConversationalJsonInternalRoute(item));
    }

    for (const [rawKey, rawChild] of Object.entries(value as Record<string, unknown>)) {
        const key = rawKey.toLowerCase().replace(/[-_\s]/g, '');
        if (['route', 'skillid', 'requestkind', 'toolscope'].includes(key)) {
            return true;
        }
        if (hasConversationalJsonInternalRoute(rawChild)) return true;
    }
    return false;
}

function pickConversationalJsonText(value: unknown): string {
    if (!value || typeof value !== 'object') return '';
    const record = value as Record<string, unknown>;

    for (const key of CONVERSATIONAL_JSON_TEXT_KEYS) {
        const direct = record[key];
        if (typeof direct === 'string' && direct.trim()) return direct.trim();
    }

    const message = record.message;
    if (message && typeof message === 'object' && !Array.isArray(message)) {
        const nested = pickConversationalJsonText(message);
        if (nested) return nested;
    }

    const choices = record.choices;
    if (Array.isArray(choices)) {
        for (const choice of choices) {
            const nested = pickConversationalJsonText(choice);
            if (nested) return nested;
        }
    }

    return '';
}

function getEnabledUserFacingSkillsForConversation(): SkillDeclaration[] {
    const integrationSettings = useAppStore.getState().integrationSettings;
    return getUserFacingSkills()
        .filter((skill) => !(isAgentMattingPaused() && skill.id === 'matte-product'))
        .filter((skill) => integrationSettings?.skills?.[skill.id]?.enabled !== false);
}

function normalizeSkillMatchText(value: unknown): string {
    return String(value || '').toLowerCase().replace(/\s+/g, '');
}

function getSkillCapabilityMatchFields(skill: SkillDeclaration): string[] {
    return [
        skill.id,
        skill.name,
        skill.description,
        ...(Array.isArray(skill.whenToUse) ? skill.whenToUse : []),
        ...(Array.isArray(skill.routing?.intentSignals) ? skill.routing.intentSignals : []),
        ...(Array.isArray(skill.routing?.decisionGuidance) ? skill.routing.decisionGuidance : [])
    ].map((item) => String(item || '').trim()).filter(Boolean);
}

function getCapabilityMatchTokensFromField(field: string): string[] {
    const raw = String(field || '').trim();
    if (!raw) return [];

    const tokens = [
        ...(raw.toLowerCase().match(/[a-z][a-z0-9-]{1,}/g) || []),
        ...(raw.match(/[\u4e00-\u9fff]{2,}/gu) || [])
    ];

    return [...new Set(tokens
        .map((token) => token.trim())
        .filter((token) => token.length >= 2)
        .filter((token) => !GENERIC_CAPABILITY_MENU_TERMS.has(normalizeSkillMatchText(token))))];
}

function scoreSkillForCapabilityQuestion(userInput: unknown, skill: SkillDeclaration): number {
    const input = normalizeSkillMatchText(userInput);
    if (!input) return 0;

    let score = 0;
    for (const field of getSkillCapabilityMatchFields(skill)) {
        const normalizedField = normalizeSkillMatchText(field);
        if (!normalizedField || normalizedField.length < 2) continue;
        if (input.includes(normalizedField)) {
            score += normalizedField.length <= 4 ? 4 : 2;
            continue;
        }
        if (normalizedField.length <= 8 && input.includes(normalizedField)) {
            score += 3;
        }
        for (const token of getCapabilityMatchTokensFromField(field)) {
            const normalizedToken = normalizeSkillMatchText(token);
            if (!normalizedToken || !input.includes(normalizedToken)) continue;
            score += normalizedToken.length <= 4 ? 6 : 3;
        }
    }
    return score;
}

type CapabilityFocusDomain = 'sku' | 'main-image' | 'detail-page';

function getCapabilityFocusDomains(userInput: unknown): Set<CapabilityFocusDomain> {
    const input = normalizeSkillMatchText(userInput);
    const domains = new Set<CapabilityFocusDomain>();
    if (!input) return domains;

    if (/(sku|自选备注|备注图|组合图|规格图|色卡)/i.test(input)) {
        domains.add('sku');
    }
    if (/(主图|点击图|转化图|白底图|首图|方图|竖图)/i.test(input)) {
        domains.add('main-image');
    }
    if (/(详情页|长图|卖点页|参数页|面料页)/i.test(input)) {
        domains.add('detail-page');
    }

    return domains;
}

function getSkillCapabilityFocusDomain(skill: SkillDeclaration): CapabilityFocusDomain | 'multi' | null {
    const normalizedId = String(skill.id || '').trim().toLowerCase();
    if (normalizedId === 'sku-batch' || normalizedId === 'sku-config') return 'sku';
    if (normalizedId === 'main-image-design') return 'main-image';
    if (normalizedId === 'detail-page-design') return 'detail-page';
    if (normalizedId === 'ecommerce-socks-design') return 'multi';
    return null;
}

function isSkillCompatibleWithCapabilityQuestion(userInput: unknown, skill: SkillDeclaration): boolean {
    const domains = getCapabilityFocusDomains(userInput);
    if (domains.size !== 1) return true;

    const skillDomain = getSkillCapabilityFocusDomain(skill);
    if (!skillDomain) return true;
    if (skillDomain === 'multi') return false;
    return domains.has(skillDomain);
}

function getConversationPromptSkills(context: AgentContext): SkillDeclaration[] {
    const enabledSkills = getEnabledUserFacingSkillsForConversation();
    if (!isAgentSkillCapabilityQuestion(context.userInput)) return enabledSkills;

    const focusedSkills = enabledSkills
        .filter((skill) => isSkillCompatibleWithCapabilityQuestion(context.userInput, skill))
        .map((skill) => ({ skill, score: scoreSkillForCapabilityQuestion(context.userInput, skill) }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score || a.skill.name.localeCompare(b.skill.name))
        .map((item) => item.skill)
        .slice(0, 4);

    return focusedSkills;
}

function buildConversationSkillSemanticScope(skill: SkillDeclaration): string {
    const normalizedId = String(skill.id || '').trim().toLowerCase();
    if (normalizedId === 'sku-batch') return 'SKU 组合图、自选备注、规格组合、SKU 素材与导出';
    if (normalizedId === 'sku-config') return 'SKU 颜色配置和占位素材准备';
    if (normalizedId === 'main-image-design') return '主图、点击图、转化图、白底图和卖点版式';
    if (normalizedId === 'detail-page-design') return '详情页模块、卖点图文、长图结构和模板延展';

    const intentTerms = Array.isArray(skill.routing?.intentSignals)
        ? skill.routing.intentSignals
            .map((term) => String(term || '').trim())
            .filter((term) => /[\u4e00-\u9fff]/u.test(term))
            .filter((term) => term.length >= 2)
            .filter((term) => !GENERIC_CAPABILITY_MENU_TERMS.has(normalizeSkillMatchText(term)))
            .slice(0, 4)
        : [];

    if (intentTerms.length > 0) return intentTerms.join('、');

    const fallback = String(skill.description || skill.name || skill.id).trim();
    return fallback || String(skill.id || '').trim();
}

function buildCapabilitySummary(context: AgentContext): string {
    const enabledSkills = getConversationPromptSkills(context)
        .map((skill) => buildConversationSkillSemanticScope(skill).trim())
        .filter(Boolean);

    if (enabledSkills.length === 0) {
        return isAgentSkillCapabilityQuestion(context.userInput)
            ? '当前问题没有匹配到明确的已启用技能；先按用户问题自然说明能力边界'
            : '当前没有启用的用户可见专业技能；开放式任务能否执行要以开始处理时的实际环境检查为准';
    }

    return enabledSkills.join('、');
}

function buildCapabilityConversationInstruction(context: AgentContext): string {
    if (!isCapabilityConversationQuestion(context.userInput)) return '';

    const semanticScope = buildCapabilitySummary(context);
    if (isAgentSkillCapabilityQuestion(context.userInput)) {
        return [
            '用户只是在问某一项能力，不是在要求现在开始处理文件。',
            `只围绕这个能力范围回答：${semanticScope}。`,
            '这些只是回答时可参考的事实，不是可复述的模板；按用户原话自然回答，不展开全部能力，不提内部路由、工具名或流程分类。',
            '可以说明你能做什么，以及真正执行前会检查素材、PSD 和版面空间；不要反问用户补充规格、素材或需求。'
        ].join('\n');
    }

    return [
        '用户是在问总体能力，不是在要求现在开始处理文件。',
        `可参考的能力范围：${semanticScope}。`,
        '自然概括即可，控制在 1 到 2 句；不逐项复述内部任务、工具分类、固定能力菜单或工作流状态。',
        '不要使用“主要帮你处理这些”“简单说”“比如”“你告诉我”这类 onboarding 句式，也不要向用户索要需求。'
    ].join('\n');
}

const GENERIC_CAPABILITY_MENU_TERMS = new Set([
    '用户',
    '工具',
    '执行',
    '处理',
    '设计',
    '图片',
    '项目',
    '当前项目',
    '素材',
    '资料',
    '任务',
    '流程',
    '结构',
    '导出',
    '保存',
    '生成',
    '制作',
    '创建',
    '新建',
    '交付',
    '结果',
    'photoshop',
    'ps',
    'agent'
]);

function getCapabilityReplyTerms(skill: SkillDeclaration): string[] {
    const terms = [
        skill.name,
        ...(Array.isArray(skill.routing?.intentSignals) ? skill.routing.intentSignals : [])
    ];
    return [...new Set(terms
        .map((term) => String(term || '').trim())
        .filter((term) => term.length >= 2)
        .filter((term) => !GENERIC_CAPABILITY_MENU_TERMS.has(normalizeSkillMatchText(term))))];
}

function isCapabilityTermRelatedToAskedTarget(normalizedTerm: string, normalizedUserInput: string): boolean {
    if (!normalizedTerm || !normalizedUserInput) return false;

    if (/(sku|自选备注|备注图|组合图)/i.test(normalizedUserInput)) {
        return /(sku|自选备注|备注图|组合图|规格|颜色|配色|双装|模板|素材|资料|导出|检查|读回|结果)/i.test(normalizedTerm);
    }

    if (/(主图|点击图|转化图|白底图)/i.test(normalizedUserInput)) {
        return /(主图|点击图|转化图|白底图|卖点|首图|方图|竖图)/i.test(normalizedTerm);
    }

    if (/(详情页|长图)/i.test(normalizedUserInput)) {
        return /(详情页|长图|模块|卖点|图文|模板)/i.test(normalizedTerm);
    }

    return false;
}

function looksLikeUnfocusedCapabilityMenuReply(text: string, context: AgentContext): boolean {
    if (!isAgentSkillCapabilityQuestion(context.userInput)) return false;

    const focusedSkillIds = new Set(getConversationPromptSkills(context).map((skill) => skill.id));
    if (focusedSkillIds.size === 0) return false;

    const reply = normalizeSkillMatchText(text);
    const userInput = normalizeSkillMatchText(context.userInput);
    if (!reply) return false;

    const unrelatedSkillHits = new Set<string>();
    for (const skill of getEnabledUserFacingSkillsForConversation()) {
        if (focusedSkillIds.has(skill.id)) continue;
        for (const term of getCapabilityReplyTerms(skill)) {
            const normalizedTerm = normalizeSkillMatchText(term);
            if (!normalizedTerm || userInput.includes(normalizedTerm)) continue;
            if (isCapabilityTermRelatedToAskedTarget(normalizedTerm, userInput)) continue;
            if (reply.includes(normalizedTerm)) {
                unrelatedSkillHits.add(skill.id);
                break;
            }
        }
    }

    return unrelatedSkillHits.size >= 1;
}

function looksLikeCrossDomainFocusedCapabilityReply(text: string, context: AgentContext): boolean {
    if (!isAgentSkillCapabilityQuestion(context.userInput)) return false;

    const domains = getCapabilityFocusDomains(context.userInput);
    if (domains.size !== 1) return false;

    const reply = normalizeSkillMatchText(text);
    if (!reply) return true;

    const [domain] = [...domains];
    if (domain === 'sku') {
        return /(主图|点击图|转化图|白底图|首图|方图|竖图|卖点版式|详情页|长图|卖点页|参数页|面料页)/i.test(reply);
    }
    if (domain === 'main-image') {
        return /(详情页|长图|卖点页|参数页|面料页|sku组合图|自选备注|备注图|规格组合)/i.test(reply);
    }
    if (domain === 'detail-page') {
        return /(主图|点击图|转化图|白底图|首图|方图|竖图|sku组合图|自选备注|备注图|规格组合)/i.test(reply);
    }

    return false;
}

function looksLikeTemplateStyleCapabilityReply(text: string, context: AgentContext): boolean {
    return isAgentSkillCapabilityQuestion(context.userInput)
        && (looksLikeFormulaicCapabilityExplainer(text)
            || looksLikeCapabilityInputSolicitation(text, context));
}

function looksLikeGeneralCapabilityMenuReply(text: string, context: AgentContext): boolean {
    if (!isCapabilityConversationQuestion(context.userInput) || isAgentSkillCapabilityQuestion(context.userInput)) {
        return false;
    }

    const value = String(text || '').trim();
    if (!value) return true;

    const hasNumberedMenu = /(^|[\s\n\r。；;：:])\d+[.、]\s*/u.test(value);
    const hasMarkdownEmphasis = /\*\*[^*]+\*\*/u.test(value);
    const markdownHeadingCount = (value.match(/\*\*[^*]{2,24}\*\*/gu) || []).length;
    const hasSectionedMarkdownMenu = markdownHeadingCount >= 2;
    const hasCapabilityFraming = /(作为.{0,8}设计搭档|设计搭档|我可以|我能|可(?:以)?帮你|视觉方案|规格组合图|SKU\s*组合图|主图|详情页|素材整理|图层调整|问题定位|能力|设计工作)/iu.test(value);
    const hasExecutionSolicitation = /(现在最需要解决|现在有具体|还是先随便聊聊|手头有素材|参考案例|告诉我|你给我描述|有什么具体|具体想法|需要解决哪类问题|哪类问题|请补充|具体目标|要处理的图层|想达到的效果)/u.test(value);
    const tooManyListItems = (value.match(/(^|[\s\n\r。；;：:])\d+[.、]/gu) || []).length >= 2;
    const sentenceCount = (value.match(/[。！？!?]/gu) || []).length;
    const domainHitCount = [
        /(主图|点击图|转化图|白底图)/u,
        /(详情页|长图)/u,
        /(SKU|sku|组合图|自选备注)/u,
        /(素材整理|素材理解|图层|导出)/u
    ].filter((pattern) => pattern.test(value)).length;
    const hasLongCapabilityOverview = sentenceCount >= 2
        && domainHitCount >= 2
        && /(主要帮你|这些事情|这些|比如|另外|简单说|你告诉我|我来判断)/u.test(value);

    return hasCapabilityFraming
        && (tooManyListItems || hasSectionedMarkdownMenu || hasLongCapabilityOverview || (hasNumberedMenu && hasMarkdownEmphasis))
        && (hasMarkdownEmphasis || hasExecutionSolicitation || value.length >= 120);
}

function looksLikeCapabilityInputSolicitation(text: string, context: AgentContext): boolean {
    if (!isAgentSkillCapabilityQuestion(context.userInput)) return false;

    const value = String(text || '').replace(/\s+/g, ' ').trim();
    if (!value) return true;

    const asksForExecutionInput = /(需要的话|如果需要|如果你有|如果有|如果要开始|如果准备开始|你可以|可以直接|直接告诉|告诉我|告诉我具体|请告诉我|补充|请提供).{0,32}(具体说说|具体需求|具体的设计需求|设计需求|规格组合|规格|颜色|配色|备注|特殊备注|要展示|要做什么|什么风格|风格|素材|配置|需求)/u.test(value)
        || /(具体需求|规格组合|规格|颜色|配色|特殊备注|要展示哪些).{0,32}(告诉我|请告诉我|补充|提供|发给我|给我|我可以帮你规划|我再)/u.test(value)
        || /(?:你可以|可以直接|请|麻烦)?(?:把|将)?(?:具体需求|规格组合|规格|颜色|配色|备注|特殊备注|素材|配置|需求).{0,28}(?:告诉我|发给我|提供给我|补充给我|给我)/u.test(value)
        || /(?:告诉我|请告诉我|发给我|提供|补充).{0,28}(?:具体需求|规格组合|规格|颜色|配色|备注|特殊备注|素材|配置|需求)/u.test(value)
        || /(?:具体你想做哪种|具体想做哪种|具体要做哪种|要做的话|如果要做|下一步|开始处理时|需要处理时).{0,40}(?:SKU|sku|图|直接说|告诉我|提供|补充|发给我|进入|处理流程|我再|素材|规格|颜色|数量)/u.test(value)
        || /(你目前有什么|你有什么).{0,24}(具体的设计需求|具体设计需求|设计需求|需求)/u.test(value)
        || /(具体需要|需要哪种|哪种类型|想要哪种|要哪种|选择哪种|偏向哪种).{0,28}(视觉呈现|呈现|类型|形式|风格|方案|规格|组合|备注|需求)/u.test(value)
        || /(请补充|需要补充|请提供|请明确|需要明确).{0,24}(具体目标|目标|图层|效果|处理对象|素材|需求)/u.test(value)
        || /(具体目标|目标|图层|处理对象|想达到的效果|达到的效果).{0,24}(请补充|需要补充|请提供|请明确|需要明确)/u.test(value);
    const hasGenericPlanningPromise = /(我可以|可以)?帮你.{0,12}(规划|处理|完成).{0,16}(视觉方案|设计方案|执行方案|素材导出|导出)/u.test(value)
        || /(我可以|我会|可以)?为你.{0,12}(规划|生成|处理|完成|制作).{0,16}(视觉方案|设计方案|执行方案|素材导出|导出)/u.test(value)
        || /(制作时|真正制作时).{0,18}(规划|生成|处理|完成).{0,16}(视觉方案|设计方案|执行方案|素材导出|导出)/u.test(value)
        || /(视觉方案|设计方案|执行方案).{0,16}(规划|处理|完成|落地|生成)/u.test(value)
        || /(设计|规划).{0,24}(SKU|sku|组合图|自选备注|规格备注).{0,20}(视觉方案|设计方案|出图方案)/u.test(value)
        || /(SKU|sku|组合图|自选备注|规格备注).{0,24}(视觉方案|设计方案|出图方案)/u.test(value);
    const hasDirectProductionPromise = /(我可以|我会|可以).{0,6}(为你)?(制作|生成|导出).{0,24}(SKU|sku|组合图|规格图|自选备注|素材|模板|导出)/u.test(value)
        || /(我可以|我会|可以).{0,6}(为你)?处理.{0,24}(素材|模板|导出)/u.test(value)
        || /(实际制作时|制作时|真正制作时).{0,32}(直接读取|直接调用|高效完成|生成|导出|处理)/u.test(value);
    const hasExportSolicitation = /(SKU|sku|组合图|规格备注|规格图|自选备注).{0,40}(导出素材|素材导出|导出文件|导出图片|导出成图)/u.test(value)
        || /(导出素材|素材导出).{0,40}(SKU|sku|组合图|规格备注|规格图|自选备注)/u.test(value);
    const hasUnverifiedQualityGuarantee = /(确保|保证).{0,20}(输出|结果|导出|规格图|设计).{0,16}(符合|达到|满足|没有问题|准确)/u.test(value)
        || /(输出|结果|导出|规格图|设计).{0,16}(确保|保证).{0,16}(符合|达到|满足|没有问题|准确)/u.test(value);
    const hasExecutionPhaseProcessDetail = /(实际制作时|制作时|真正制作时|真正执行时|需要制作时).{0,40}(读取|调用|项目素材|当前项目|配置|模板|规格|导出后复核|高效完成|进入)/u.test(value)
        || /(读取|调用).{0,10}(当前项目|项目).{0,24}(素材|配置|模板|规格)/u.test(value)
        || /(导出后复核|受控处理流程)/u.test(value);
    if (!asksForExecutionInput
        && !hasGenericPlanningPromise
        && !hasDirectProductionPromise
        && !hasExportSolicitation
        && !hasUnverifiedQualityGuarantee
        && !hasExecutionPhaseProcessDetail) return false;

    const normalizedInput = normalizeSkillMatchText(context.userInput);
    if (/(sku|自选备注|备注图|组合图)/i.test(normalizedInput)) {
        return asksForExecutionInput
            || hasUnverifiedQualityGuarantee;
    }

    if (/(主图|点击图|转化图|白底图)/i.test(normalizedInput)) {
        return asksForExecutionInput
            || hasUnverifiedQualityGuarantee
            || (hasGenericPlanningPromise && /(视觉方案|设计方案|出图方案)/u.test(value));
    }

    if (/(详情页|长图)/i.test(normalizedInput)) {
        return asksForExecutionInput
            || hasUnverifiedQualityGuarantee
            || (hasGenericPlanningPromise && /(视觉方案|设计方案|出图方案)/u.test(value));
    }

    return asksForExecutionInput
        || hasGenericPlanningPromise
        || hasDirectProductionPromise
        || hasUnverifiedQualityGuarantee
        || hasExecutionPhaseProcessDetail;
}

function classifyInvalidCapabilityReplyReason(text: string, context: AgentContext): string | null {
    if (!isCapabilityConversationQuestion(context.userInput)) return null;
    if (looksLikeCannedCapabilityMenu(text)) return 'canned_capability_menu';

    if (!isAgentSkillCapabilityQuestion(context.userInput)) {
        if (looksLikeFormulaicCapabilityExplainer(text)) return 'formulaic_capability_explainer';
        if (looksLikeGeneralCapabilityMenuReply(text, context)) return 'general_capability_menu';
        return null;
    }

    const cleaned = sanitizeUserVisibleAssistantBodyText(text).trim();
    if (!cleaned) return 'empty_after_sanitizer';
    if (looksLikeCrossDomainFocusedCapabilityReply(text, context)) return 'cross_domain_capability_reply';
    if (looksLikeUnfocusedCapabilityMenuReply(text, context)) return 'unfocused_capability_menu';
    if (looksLikeFormulaicCapabilityExplainer(text)) return 'formulaic_capability_explainer';
    if (!hasFocusedAskedCapabilityTerm(text, context) && !isShortAffirmativeCapabilityAnswer(cleaned, context)) {
        return 'unfocused_capability_reply';
    }
    if (looksLikeCapabilityInputSolicitation(text, context)) return 'capability_input_solicitation';
    if (looksLikeTemplateStyleCapabilityReply(text, context)) return 'template_style_capability_reply';
    return null;
}

function isShortAffirmativeCapabilityAnswer(text: string, context: AgentContext): boolean {
    if (!isAgentSkillCapabilityQuestion(context.userInput)) return false;
    const value = String(text || '').replace(/\s+/g, '').trim();
    if (!value || value.length > 28) return false;
    return /^(可以|可以的|会|会的|能|能的|支持|没问题|当然可以|当然|可以做|能做|会做)[。.!！]*$/u.test(value);
}

function hasFocusedAskedCapabilityTerm(text: string, context: AgentContext): boolean {
    if (!isAgentSkillCapabilityQuestion(context.userInput)) return true;
    const value = String(text || '');
    const userText = String(context.userInput || '');
    if (/(sku|自选备注|备注图|组合图)/i.test(userText)) {
        return /(SKU|sku|自选备注|备注图|组合图|规格图|色卡)/u.test(value);
    }
    if (/(主图|点击图|转化图|白底图)/i.test(userText)) {
        return /(主图|点击图|转化图|白底图|版式|卖点)/u.test(value);
    }
    if (/(详情页|长图)/i.test(userText)) {
        return /(详情页|长图|模块|版式|卖点)/u.test(value);
    }
    return true;
}

function isInvalidCapabilityReplyCandidate(text: string, context: AgentContext): boolean {
    return Boolean(classifyInvalidCapabilityReplyReason(text, context));
}

function classifyConversationalReplyRejectionReason(
    text: string,
    context: AgentContext,
    intentControlPlane: AgentIntentControlPlaneDecision
): string {
    return classifyInvalidCapabilityReplyReason(text, context)
        || (containsUnsupportedProjectFactClaim(text, context) ? 'unsupported_project_fact_claim' : '')
        || (isUnsuitablePlanOnlyReply(text, intentControlPlane) ? 'plan_only_reply_solicited_user_input' : '')
        || (isLikelyTruncatedConversationalReply(text) ? 'truncated_or_incomplete_reply' : '')
        || (isUnsuitableExplanationOnlyReply(text, context) ? 'unsuitable_explanation_only_reply' : '')
        || 'invalid_or_non_natural_reply';
}

function stripCapabilityInputSolicitation(text: string, context: AgentContext): string | null {
    if (!isCapabilityConversationQuestion(context.userInput)) return null;
    let value = String(text || '').replace(/\s+/g, ' ').trim();
    if (!value) return null;

    value = value
        .replace(/(?:需要的话|如果需要|如果你有|如果有|如果要开始|如果准备开始|你可以|可以直接|直接告诉|告诉我|请告诉我|请提供|补充).{0,90}(?:具体说说|具体需求|具体的设计需求|设计需求|规格组合|规格|颜色|配色|备注|特殊备注|要展示|要做什么|什么风格|风格|素材|配置|需求|视觉方案)[^。！？!?]*[。！？!?]?/gu, '')
        .replace(/(?:具体需求|规格组合|规格|颜色|配色|特殊备注|要展示哪些).{0,90}(?:告诉我|请告诉我|补充|提供|发给我|给我|我可以帮你规划|我再)[^。！？!?]*[。！？!?]?/gu, '')
        .replace(/(?:你可以|可以直接|请|麻烦)?(?:把|将)?(?:具体需求|规格组合|规格|颜色|配色|备注|特殊备注|素材|配置|需求).{0,90}(?:告诉我|发给我|提供给我|补充给我|给我)[^。！？!?]*[。！？!?]?/gu, '')
        .replace(/(?:告诉我|请告诉我|发给我|提供|补充).{0,90}(?:具体需求|规格组合|规格|颜色|配色|备注|特殊备注|素材|配置|需求)[^。！？!?]*[。！？!?]?/gu, '')
        .replace(/(?:具体你想做哪种|具体想做哪种|具体要做哪种|要做的话|如果要做|下一步|开始处理时|需要处理时).{0,90}(?:SKU|sku|图|直接说|告诉我|提供|补充|发给我|进入|处理流程|我再|素材|规格|颜色|数量)[^。！？!?]*[。！？!?]?/gu, '')
        .replace(/(?:你目前有什么|你有什么).{0,90}(?:具体的设计需求|具体设计需求|设计需求|需求)[^。！？!?]*[。！？!?]?/gu, '')
        .replace(/(?:具体需要|需要哪种|哪种类型|想要哪种|要哪种|选择哪种|偏向哪种).{0,90}(?:视觉呈现|呈现|类型|形式|风格|方案|规格|组合|备注|需求)[^。！？!?]*[。！？!?]?/gu, '')
        .replace(/(?:请补充|需要补充|请提供|请明确|需要明确).{0,90}(?:具体目标|目标|图层|效果|处理对象|素材|需求)[^。！？!?]*[。！？!?]?/gu, '')
        .replace(/(?:具体目标|目标|图层|处理对象|想达到的效果|达到的效果).{0,90}(?:请补充|需要补充|请提供|请明确|需要明确)[^。！？!?]*[。！？!?]?/gu, '')
        .replace(/\s{2,}/g, ' ')
        .replace(/[，,；;：:、\s]+$/u, '')
        .trim();

    if (!value) return null;
    if (!/[。！？.!?]$/u.test(value)) value = `${value}。`;
    return value;
}

function tryBuildSanitizedCapabilityReply(text: string, context: AgentContext): string | null {
    if (!isCapabilityConversationQuestion(context.userInput)) {
        return null;
    }
    const cleaned = stripCapabilityInputSolicitation(text, context);
    if (!cleaned) return null;
    if (cleaned === String(text || '').replace(/\s+/g, ' ').trim()) return null;
    if (classifyInvalidCapabilityReplyReason(cleaned, context)) return null;
    if (isLikelyTruncatedConversationalReply(cleaned)) return null;
    if (isUnsuitableExplanationOnlyReply(cleaned, context)) return null;
    return cleaned;
}

function getConversationModelHint(): string {
    const prefs = useAppStore.getState().modelPreferences;
    if (!prefs) return '当前已配置的通用对话模型';

    const localModel = String(prefs.preferredLocalModels?.layoutAnalysis || '').trim();
    const cloudModel = String(prefs.preferredCloudModels?.layoutAnalysis || '').trim();

    if (prefs.mode === 'local') {
        return localModel || '本地通用模型';
    }
    if (prefs.mode === 'cloud') {
        return cloudModel || '云端通用模型';
    }

    if (localModel && cloudModel) {
        return `${localModel}（本地优先） / ${cloudModel}（云端备选）`;
    }
    return localModel || cloudModel || '当前已配置的通用对话模型';
}

const PROJECT_CONTEXT_CONVERSATION_PATTERN = /(当前|这个|项目|project|素材|图片|项目图片|款式|品类|类目|卖点|特征|风格|文件夹|目录|资源|已有|现有|都有什么|都有些什么|包含什么|包括什么)/i;
const RUNTIME_STATE_CONVERSATION_PATTERN = /(当前|现在|连接|photoshop|ps|文档|打开|状态|能不能开始|是否可以开始|可以开始|能否执行|能不能执行|能否处理|能不能处理)/i;
const GENERAL_CAPABILITY_CONVERSATION_PATTERN = /(你|agent|智能体|模型).{0,8}(都)?(可以|能|会|支持).{0,12}(做什么|会做什么|帮我做什么|能力|哪些能力|什么能力|支持什么)/i;

function isCapabilityConversationQuestion(value: unknown): boolean {
    const text = String(value || '');
    return isAgentSkillCapabilityQuestion(text) || GENERAL_CAPABILITY_CONVERSATION_PATTERN.test(text);
}

function shouldIncludeProjectContextInConversationalReply(context: AgentContext): boolean {
    if (!context.projectContext?.projectPath && !context.projectContext?.projectImageCount) return false;
    const userText = String(context.userInput || '');
    if (!userText.trim()) return false;
    return PROJECT_CONTEXT_CONVERSATION_PATTERN.test(userText);
}

function resolveConfirmedProjectImageCount(context: AgentContext): number {
    const project = context.projectContext as any;
    return Math.max(
        0,
        Number(project?.projectImageCount || 0),
        Number(project?.assetIndex?.summary?.totalImages || 0)
    );
}

function resolveConfirmedProjectName(context: AgentContext): string {
    const project = context.projectContext;
    const declaredName = String(project?.projectName || project?.assetIndex?.projectName || '').trim();
    if (declaredName) return declaredName;

    const projectPath = String(project?.projectPath || '').trim();
    return projectPath.split(/[\\/]/).filter(Boolean).pop() || '';
}

function describeProjectFolderForDesigner(context: AgentContext): string {
    const projectPath = String(context.projectContext?.projectPath || '').trim();
    const projectName = resolveConfirmedProjectName(context);
    const driveMatch = projectPath.match(/^([A-Za-z]):[\\/](.+)$/);
    if (!driveMatch) {
        return projectName ? `“${projectName}”项目文件夹` : '当前导入的项目文件夹';
    }

    const segments = driveMatch[2].split(/[\\/]/).filter(Boolean);
    if (segments.length === 0) return `${driveMatch[1].toUpperCase()} 盘的项目文件夹`;
    if (segments.length === 1) {
        return `${driveMatch[1].toUpperCase()} 盘的 ${segments[0]} 文件夹`;
    }

    const folderName = segments[segments.length - 1];
    const parentLocation = segments.slice(0, -1).join(' / ');
    return `${driveMatch[1].toUpperCase()} 盘 ${parentLocation} 下的 ${folderName} 文件夹`;
}

function buildProjectFactBoundaryPromptSection(context: AgentContext): string {
    if (context.operatingContextSnapshot) {
        return [
            '## 当前项目事实边界',
            '项目、页面、选中素材与工作流身份只以 Runtime context 中的本轮提交情境快照为基线。',
            '项目索引数量等补充信息不得覆盖该快照，也不得据此推断未观察到的品类、SKU 配置、模板、PSD/PSB 文档或素材内容。'
        ].join('\n');
    }
    const confirmedImageCount = resolveConfirmedProjectImageCount(context);
    const hasProjectPath = Boolean(String(context.projectContext?.projectPath || '').trim());
    const needsProjectContext = shouldIncludeProjectContextInConversationalReply(context);
    const projectName = resolveConfirmedProjectName(context);
    const projectFolder = describeProjectFolderForDesigner(context);

    if (needsProjectContext && hasProjectPath) {
        const lines = [
            '## 当前项目事实边界',
            `当前活动项目名称：${projectName || '未命名项目'}。`,
            `当前活动项目位置：${projectFolder}。`,
            '项目名称和位置是应用已经确认的事实。用户询问当前项目时直接、自然地回答，不要说尚未读取；位置使用上面的设计师可读说法，不输出反斜杠形式的原始本地路径。'
        ];
        if (confirmedImageCount > 0) {
            lines.push(
                `当前项目索引只确认可参考 ${confirmedImageCount} 张图片。`,
                '只能陈述已确认的数量或已提供的文件名；不要据此推断当前项目的品类、款式、SKU 配置、模板、PSD/PSB 文档或素材内容。'
            );
        } else {
            lines.push(
                '当前还没有可确认的项目图片或素材信息。',
                '不要说项目里已经有图片、SKU 文档、模板、配置或可直接用于执行的素材；如果需要项目内容事实，应先做只读检查。'
            );
        }
        return lines.join('\n');
    }

    return [
        '## 当前项目事实边界',
        '本轮不需要引用当前项目素材信息。',
        '不要根据历史对话、领域术语或能力范围断言当前项目已有素材、图片、SKU 文档、模板、配置或商品品类；需要举例时使用条件表达。'
    ].join('\n');
}

function shouldIncludeRuntimeStateInConversationalReply(context: AgentContext): boolean {
    const userText = String(context.userInput || '');
    if (!userText.trim()) return false;
    return RUNTIME_STATE_CONVERSATION_PATTERN.test(userText);
}

function buildFocusedCapabilityResponsePromptSection(context: AgentContext): string {
    const semanticScope = buildCapabilitySummary(context);
    const userText = String(context.userInput || '');
    const lines = [
        '## 用户这次问到的能力范围',
        `只回答用户这次问到的具体能力：${semanticScope}。`,
        '这些是能力事实，不是回复模板；不要输出能力总览、能力菜单、固定自我介绍、下一步公式或 onboarding 句式。',
        '能力咨询只回答会不会、能覆盖哪些对象、边界是什么；不要索要具体规格、特殊备注、素材配置或把回复结尾写成“告诉我需求再规划”的执行前公式。',
        '不要写成“为你制作、生成、导出、直接调用项目素材、确保输出、高效完成”的执行承诺；能力边界只说明可处理对象，不承诺本轮已经满足执行条件。',
        '像正常聊天一样回答 1 到 2 句；不要展开执行步骤，不要补充未被问到的能力，不要输出“对话/只读/执行”等内部分类。'
    ];

    if (/(sku|自选备注|备注图|组合图)/i.test(userText)) {
        lines.push(
            '术语参考：在电商袜子 SKU 场景里，SKU 自选备注通常指 2双、3双、4双等规格对应的自选备注图或备注文件；这里仅用于回答术语边界，不代表当前项目已有对应素材。'
        );
    }

    return lines.join('\n');
}

function buildResponseKnowledgePromptSection(context: AgentContext): string {
    if (isAgentSkillCapabilityQuestion(context.userInput)) {
        return buildFocusedCapabilityResponsePromptSection(context);
    }

    const promptSkills = getConversationPromptSkills(context);
    const enabledSkillIds = new Set(promptSkills.map((skill) => skill.id));
    const skillFacts = promptSkills.map((skill) => ({
        id: skill.id,
        name: buildConversationSkillSemanticScope(skill),
        visibility: skill.visibility,
        enabled: enabledSkillIds.has(skill.id)
    }));

    let preferenceItems: ReturnType<ReturnType<typeof getMemoryService>['listPreferenceItems']> = [];
    let knowledgeResults: ReturnType<ReturnType<typeof getMemoryService>['getDesignKnowledgeResults']> = [];

    try {
        if (typeof localStorage === 'undefined') {
            return renderAgentResponseKnowledgePromptSection(buildAgentResponseKnowledgeBundle({
                userText: context.userInput,
                skillFacts,
                projectContext: shouldIncludeProjectContextInConversationalReply(context)
                    ? context.projectContext
                    : undefined
            }));
        }

        const memory = getMemoryService();
        const memoryScope = resolveAgentProjectMemoryScope(context.projectContext);
        preferenceItems = memory.listPreferenceItems({ scope: memoryScope });
        knowledgeResults = memory.getDesignKnowledgeResults({
            query: [
                context.userInput,
                '用户偏好',
                '设计风格',
                '字体',
                '排版',
                '颜色',
                '文案',
                '工作流',
                '主图',
                '详情页',
                'SKU'
            ].join(' '),
            intents: ['rule', 'copywriting'],
            sourceTypes: ['local_case'],
            limit: 8
        }, { scope: memoryScope });
    } catch (error) {
        console.warn('[conversational] failed to build memory-backed response knowledge bundle:', error);
    }

    return renderAgentResponseKnowledgePromptSection(buildAgentResponseKnowledgeBundle({
        userText: context.userInput,
        skillFacts,
        preferenceItems,
        knowledgeResults,
        projectContext: shouldIncludeProjectContextInConversationalReply(context)
            ? context.projectContext
            : undefined
    }));
}

export async function captureExplicitPreferenceFeedback(
    context: AgentContext,
    assistantReply: string,
    callModel: NonNullable<ProcessOptions['callModel']>
): Promise<void> {
    if (!shouldAttemptPreferenceFeedbackCapture(context.userInput)) return;
    if (typeof localStorage === 'undefined') return;

    try {
        const result = await callModel(
            buildAgentPreferenceFeedbackMessages({
                userText: context.userInput,
                assistantReply
            }),
            {
                temperature: 0,
                maxTokens: 500,
                stream: false,
                silent: true,
                purpose: 'preference_feedback'
            }
        );
        const decision = normalizeAgentPreferenceFeedbackDecision(String(result?.text || ''));
        if (!decision.shouldSave) return;

        const memory = getMemoryService();
        for (const preference of decision.preferences) {
            memory.upsertExplicitPreference({
                category: preference.category,
                value: preference.value,
                label: preference.label,
                sourceNote: preference.sourceNote
            });
        }
    } catch (error) {
        console.warn('[conversational] explicit preference feedback capture skipped:', error);
    }
}

function isUnhelpfulClarificationFollowupReply(text: string, options?: { clarificationFollowup?: ClarificationFollowupContext }): boolean {
    if (!options?.clarificationFollowup) return false;
    const value = String(text || '').trim();
    if (!value) return true;
    return /这是对话问题|不会默认触发 Photoshop|不会触发 Photoshop 执行/.test(value);
}

function containsToolCallLikeText(text: string): boolean {
    const value = String(text || '');
    return /<\s*tool_call\b/i.test(value)
        || /<\/\s*tool_call\s*>/i.test(value)
        || /<\s*function\s*=/i.test(value)
        || /<\/\s*function\s*>/i.test(value)
        || /\btool_use\b/i.test(value);
}

function hasExplanationOnlyNoToolDirective(text: string): boolean {
    const value = String(text || '');
    const asksForExplanation = /(只|仅|先只|先帮我|先给我|先).{0,12}(说明|解释|回答|分析|理解|描述|总结|说说)/i.test(value);
    const forbidsTools = /(不要|别|先别|不需要|无需|禁止|不用|不执行|不调用).{0,18}(执行|调用|使用|跑|操作|工具|skill|技能|photoshop|ps)/i.test(value);
    return asksForExplanation && forbidsTools;
}

function looksLikeFailedConversationalAssistantMessage(text: string): boolean {
    const value = String(text || '').replace(/\s+/g, ' ').trim();
    return /对话模型没有返回有效内容/.test(value)
        || /\bConversational reply unavailable\b/i.test(value)
        || /我会重新组织可读回复/.test(value);
}

function buildConversationalPromptHistory(context: AgentContext): Array<{ role: 'user' | 'assistant'; content: string }> {
    const filteredHistory = context.conversationHistory
        .slice(-10)
        .filter((item) => {
            const content = String(item.content || '').trim();
            if (!content) return false;
            if (item.role !== 'assistant') return true;
            if (looksLikeCannedCapabilityMenu(content)) return false;
            if (looksLikeFormulaicCapabilityExplainer(content)) return false;
            if (
                isCapabilityConversationQuestion(context.userInput)
                && isInvalidCapabilityReplyCandidate(content, context)
            ) {
                return false;
            }
            if (looksLikeFailedConversationalAssistantMessage(content)) return false;
            if (containsToolCallLikeText(content)) return false;
            if (containsUnsupportedProjectFactClaim(content, context)) return false;
            return true;
        });
    const compiledHistory = compileAgentConversationHistoryData({
        messages: filteredHistory,
        currentUserInput: context.userInput,
        source: 'conversational-agent-history',
        maxEntries: 6,
        maxCharactersPerEntry: 1400,
        maxTotalCharacters: 5600
    });
    if (!compiledHistory.prompt) return [];
    return [{
        role: 'user',
        content: compiledHistory.prompt
    }];
}

function isUnsuitableExplanationOnlyReply(text: string, context: AgentContext): boolean {
    if (!hasExplanationOnlyNoToolDirective(context.userInput)) return false;
    const value = String(text || '').trim();
    if (!value) return true;
    if (/(---|\*\*|(^|\s|\n)[-*]\s+|(^|\s|\n)\d+[.、)])/u.test(value)) return true;
    return /(请问|方便提供|请提供|请补充|请明确|需要你提供|能否提供|是否方便|要处理哪个|要处理哪些|哪些信息|具体信息)/u.test(value);
}

function containsInternalRouteToken(text: string): boolean {
    return /\b(?:direct_response|clarification_needed|ready_direct_response|blocked_needs_clarification|needs_model_design_decision|needs_visual_observation|Conversational reply unavailable)\b/i.test(String(text || ''));
}

function looksLikeGenericPhotoshopClarification(text: string): boolean {
    const value = String(text || '').replace(/\s+/g, ' ').trim();
    if (!value) return true;
    return /(需要先|请先|请补充|需要补充|请明确|需要明确).{0,22}(具体目标|目标|图层|哪一层|哪个画面|处理对象|想达到的效果|是否允许修改当前文档)/u.test(value)
        || /(具体目标|目标|图层|哪一层|哪个画面|处理对象|想达到的效果|是否允许修改当前文档).{0,22}(需要先|请先|请补充|需要补充|请明确|需要明确)/u.test(value);
}

function normalizeConversationalReplyCandidate(
    text: string,
    options?: ConversationalModelReplyOptions
): string | null {
    const reply = sanitizeUserVisibleAssistantBodyText(String(text || '')).trim();
    if (!reply) return null;
    if (containsToolCallLikeText(reply)) return null;
    if (containsInternalRouteToken(reply)) return null;
    if (!options?.allowStructuredPlan && looksLikeCannedCapabilityMenu(reply)) return null;
    if (isUnhelpfulClarificationFollowupReply(reply, options)) return null;
    if (options?.intentClarification && looksLikeGenericPhotoshopClarification(reply)) return null;
    return reply;
}

function containsUnsupportedProjectFactClaim(text: string, context: AgentContext): boolean {
    const value = sanitizeUserVisibleAssistantBodyText(String(text || ''))
        .replace(/\s+/g, ' ')
        .trim();
    if (!value) return false;

    const userText = String(context.userInput || '');
    const confirmedImageCount = resolveConfirmedProjectImageCount(context);
    const needsProjectContext = shouldIncludeProjectContextInConversationalReply(context);
    const isExplanationOnlyTaskUnderstanding = hasExplanationOnlyNoToolDirective(userText)
        && /(帮我|做|生成|导出|处理|设计|SKU|sku|主图|详情页|白底图|自选备注)/u.test(userText);
    if (isExplanationOnlyTaskUnderstanding) return false;

    const userExplicitlyStatesProductType = /(袜子|短袜|月子袜|服饰|电商|淘宝|天猫|SKU|sku)/u.test(userText)
        && /(项目|这个|当前|素材|商品|产品)/u.test(userText);

    const claimsCurrentProjectResourceExists =
        /(当前项目|这个项目|本项目|项目里|项目中).{0,36}(已有|已经有|包含|扫描到|准备好|可直接|可以直接|能直接).{0,56}(素材|图片|照片|图像|SKU|sku|文档|PSD|PSB|模板|配置|袜子|商品|产品)/u.test(value)
        || /(当前项目|这个项目|本项目|项目里|项目中).{0,24}有.{0,24}(SKU|sku|PSD|PSB|模板|配置文件|色卡文件)/u.test(value)
        || /(基于|读取|调用).{0,16}(当前项目|这个项目|本项目|项目里|项目中).{0,36}(素材|图片|照片|SKU|sku|文档|PSD|PSB|模板|配置)/u.test(value);

    const claimsCurrentProjectType =
        /(当前项目|这个项目|本项目).{0,18}(是|属于|为).{0,36}(电商|袜子|短袜|月子袜|SKU|sku|主图|详情页|淘宝|天猫|商品|产品)/u.test(value);

    if (claimsCurrentProjectType && !userExplicitlyStatesProductType) return true;
    if (claimsCurrentProjectResourceExists && (!needsProjectContext || confirmedImageCount <= 0)) return true;
    return false;
}

function isRejectedConversationalReplyCandidate(
    text: string,
    context: AgentContext,
    intentControlPlane: AgentIntentControlPlaneDecision
): boolean {
    return isInvalidCapabilityReplyCandidate(text, context)
        || containsUnsupportedProjectFactClaim(text, context)
        || isUnsuitablePlanOnlyReply(text, intentControlPlane)
        || isLikelyTruncatedConversationalReply(text)
        || isUnsuitableExplanationOnlyReply(text, context);
}

function extractConversationalReplyFromModelText(
    text: string,
    options?: {
        clarificationFollowup?: ClarificationFollowupContext;
        intentClarification?: {
            requestKind?: string;
            userVisibleSummary?: string;
            reason?: string;
            matchedSignals?: string[];
        };
    }
): string | null {
    const raw = String(text || '').trim();
    if (!raw) return null;
    if (containsToolCallLikeText(raw)) return null;

    const parsed = parseJsonBlock(raw);
    if (parsed && typeof parsed === 'object') {
        const direct = typeof parsed.directResponse === 'string' ? parsed.directResponse.trim() : '';
        if (direct && !hasConversationalJsonToolIntent(parsed)) {
            return normalizeConversationalReplyCandidate(direct, options);
        }

        if (!hasConversationalJsonToolIntent(parsed) && !hasConversationalJsonInternalRoute(parsed)) {
            const visibleText = pickConversationalJsonText(parsed);
            if (visibleText) {
                return normalizeConversationalReplyCandidate(visibleText, options);
            }
        }

        return null;
    }

    const reply = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    return normalizeConversationalReplyCandidate(reply, options);
}

function isLikelyTruncatedConversationalReply(text: string): boolean {
    const value = String(text || '').trim();
    if (!value) return true;

    const boldMarkerCount = (value.match(/\*\*/g) || []).length;
    if (boldMarkerCount % 2 === 1) return true;

    const asciiDoubleQuoteCount = (value.match(/"/g) || []).length;
    if (asciiDoubleQuoteCount % 2 === 1) return true;
    const chineseLeftQuoteCount = (value.match(/“/g) || []).length;
    const chineseRightQuoteCount = (value.match(/”/g) || []).length;
    if (chineseLeftQuoteCount !== chineseRightQuoteCount) return true;

    if (/[:：]\s*([*_`#-]+\s*)?$/u.test(value)) return true;
    if (/[（(【[《“"']\s*$/u.test(value)) return true;
    if (/[，,、；;]$/u.test(value)) return true;
    if (/(?:简单说|也就是说)[，,]?\s*(?:你|用户|只要|告诉我)[。.!！]?$/u.test(value)) return true;
    if (/(需要|还是|以及|包括|例如|比如|或者|是否|哪个|哪些|什么|不能|不是|不要|不会|无法|不该|不应|应该|必须|并且|而是|但是|因为|所以)$/u.test(value)) return true;
    if (/(^|\s|\n)\d+[.、)]\s*[^。！？.!?]*$/u.test(value)) return true;
    if (/(如下|包括|分为|步骤|拆解任务|先确认|先检查)/u.test(value)
        && /(^|\s|\n)\d+[.、)]/u.test(value)
        && !/[。！？.!?]$/u.test(value)) return true;
    if (/(---|\*\*|(^|\s|\n)[-*]\s+|(^|\s|\n)\d+[.、)])/u.test(value)
        && !/[。！？.!?]$/u.test(value)
        && /(理解|说明|需求|拆解|确认|素材|处理方式|输出位置)/u.test(value)) return true;
    if (!/[。！？.!?]$/u.test(value)
        && value.length >= 40
        && /(?:[-—]{2,}|不能|不要|不应|不该|不是|替代|模拟|限制|调用|执行|使用|负责|判断|决定|理解|确认)[^。！？.!?]{0,28}(?:工具|步骤|信息|素材|文件|图片|文档|结果|问题)$/u.test(value)) {
        return true;
    }
    if (/[。！？.!?]$/u.test(value)) return false;

    if (/[\u4e00-\u9fff]/u.test(value) && value.length >= 30) return true;
    if (!/[。！？.!?]$/u.test(value) && value.length >= 80) return true;

    return value.length < 40
        && /[:：*#`]/u.test(value)
        && /(理解|说明|需求|总结|包括|如下|是)/u.test(value);
}

export function buildLocalConversationalReply(intent: LightweightIntent, context: AgentContext): string | null {
    void context;
    switch (intent) {
        case 'identity':
        case 'model_compare':
        case 'capability':
        case 'greeting':
        case 'thanks':
        case 'ack':
            return null;
        case 'task_summary':
            return null;
        case 'continuation':
            return null;
        case 'chat':
            return null;
        default:
            return null;
    }
}

export type ConversationalModelReplyOptions = {
    allowStructuredPlan?: boolean;
    clarificationFollowup?: ClarificationFollowupContext;
    intentControlPlane?: AgentIntentControlPlaneDecision;
    intentClarification?: {
        requestKind?: string;
        userVisibleSummary?: string;
        reason?: string;
        matchedSignals?: string[];
    };
};

export type ConversationalModelFailureKind =
    | 'auth'
    | 'network'
    | 'timeout'
    | 'rate_limit'
    | 'empty'
    | 'rejected_by_cleaner'
    | 'unknown';

export type ConversationalModelFailureAttempt = {
    purpose: 'direct_response' | 'direct_response_repair';
    status: 'error' | 'empty' | 'rejected';
    errorKind?: ConversationalModelFailureKind;
    reason?: string;
};

export type ConversationalModelFailure = {
    version: 'conversational-model-failure/v0';
    kind: ConversationalModelFailureKind;
    attempts: ConversationalModelFailureAttempt[];
};

export type ConversationalModelReplyDetailedResult = {
    reply: string | null;
    failure?: ConversationalModelFailure;
    repaired?: boolean;
};

function classifyConversationalModelError(error: unknown): ConversationalModelFailureKind {
    const value = String(error instanceof Error ? `${error.name} ${error.message}` : error || '').toLowerCase();
    if (!value) return 'unknown';
    if (/\b(?:401|403|unauthorized|forbidden|invalid api key|api key|authentication|auth)\b/i.test(value)) return 'auth';
    if (/\b(?:429|rate limit|too many requests)\b/i.test(value)) return 'rate_limit';
    if (/\b(?:timeout|timed out|etimedout)\b/i.test(value)) return 'timeout';
    if (/\b(?:network|fetch|econn|enotfound|socket|connection|dns)\b/i.test(value)) return 'network';
    return 'unknown';
}

function pickConversationalFailureKind(attempts: ConversationalModelFailureAttempt[]): ConversationalModelFailureKind {
    const kinds = attempts.map((attempt) => attempt.errorKind).filter(Boolean) as ConversationalModelFailureKind[];
    for (const kind of ['auth', 'rate_limit', 'timeout', 'network'] as ConversationalModelFailureKind[]) {
        if (kinds.includes(kind)) return kind;
    }
    if (attempts.some((attempt) => attempt.status === 'empty')) return 'empty';
    if (attempts.some((attempt) => attempt.status === 'rejected')) return 'rejected_by_cleaner';
    return kinds[0] || 'unknown';
}

function buildConversationalModelFailure(
    attempts: ConversationalModelFailureAttempt[]
): ConversationalModelFailure {
    return {
        version: 'conversational-model-failure/v0',
        kind: pickConversationalFailureKind(attempts),
        attempts: attempts.slice(0, 4)
    };
}

function buildConversationalModelErrorAttempt(
    purpose: ConversationalModelFailureAttempt['purpose'],
    error: unknown
): ConversationalModelFailureAttempt {
    return {
        purpose,
        status: 'error',
        errorKind: classifyConversationalModelError(error)
    };
}

function buildConversationalModelRejectedAttempt(
    purpose: ConversationalModelFailureAttempt['purpose'],
    rawText: unknown,
    reason?: string
): ConversationalModelFailureAttempt {
    const hasModelText = String(rawText || '').trim().length > 0;
    return {
        purpose,
        status: hasModelText ? 'rejected' : 'empty',
        reason: hasModelText ? (reason || 'invalid_or_non_natural_reply') : 'empty_model_text'
    };
}

function isPlanOnlyConversation(intentControlPlane: AgentIntentControlPlaneDecision): boolean {
    return intentControlPlane.requestKind === 'plan_only';
}

function normalizeCopyMatchText(value: unknown): string {
    return String(value || '').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

function hasMatchingCopyTarget(context: AgentContext): boolean {
    const photoshop = context.operatingContextSnapshot?.photoshop;
    if (!photoshop || photoshop.observation.freshness !== 'current') return false;
    if (photoshop.documentState !== 'present' || !photoshop.document || !photoshop.activeLayer) return false;

    const layerName = String(photoshop.activeLayer.name || '').trim();
    const normalizedLayerName = normalizeCopyMatchText(layerName);
    const normalizedUserText = normalizeCopyMatchText(context.userInput);
    return normalizedLayerName.length >= 8 && normalizedUserText.includes(normalizedLayerName);
}

function buildStandaloneCopyDeliveryInstruction(
    context: AgentContext,
    intentControlPlane: AgentIntentControlPlaneDecision
): string {
    if (!intentControlPlane.matchedSignals.includes('standalone_copy_deliverable')) return '';
    const matchingTarget = hasMatchingCopyTarget(context);
    return [
        '当前请求的首要交付物是可直接使用的文案，不是 Photoshop 写入。先完成用户明确提出的改写目标；用户没有指定数量时，优先给出三版方向有差异、可直接使用的候选。',
        '不要用确认卡、执行计划、信息补充问题或“尚未完成”代替文案交付。不要声称已经修改画面。',
        matchingTarget
            ? '本轮只读上下文确认：当前活动图层名称与用户给出的原文一致。可以根据 Runtime context 中的文档与图层事实，在候选文案之后自然说明这一发现，并询问用户是否要把选中的版本写入该图层；同时给出明确可执行的回复示例，例如“把第2版替换到当前文字图层”。这是可选的下一步，不影响本轮文案已经交付完成。'
            : '没有确认到与原文一致的当前图层时，只交付文案，不要编造页面或图层命中，也不要为了寻找写入目标阻塞本轮回答。'
    ].join('\n');
}

function buildPlanOnlyConversationBoundaryInstruction(
    intentControlPlane: AgentIntentControlPlaneDecision
): string {
    if (!isPlanOnlyConversation(intentControlPlane)) return '';
    return [
        '当前是只规划请求：只给计划，不要执行、不要承诺已经创建、保存或导出任何文件。',
        '计划必须围绕用户明确点名的目标交付物；素材来源、参考对象、文件名、品类词或上下文信息不能被扩展成额外交付物。',
        '如果用户说“基于某类素材创建某个文档”，被创建的那个文档才是目标，素材只是输入来源；不要自行增加另一个文档或另一类成品。',
        '信息不完整时也先基于已知内容和合理默认值给计划，不要列问题让用户补充。',
        '输出时直接写给用户的自然短段，不要使用标题、编号、列表、加粗，不要复述本段规则或句数限制。',
        '用三到四个短句说明目标、素材来源、版面结构和下一步检查；不要要求用户确认计划。'
    ].join('\n');
}

function isUnsuitablePlanOnlyReply(
    text: string,
    intentControlPlane: AgentIntentControlPlaneDecision
): boolean {
    if (!isPlanOnlyConversation(intentControlPlane)) return false;
    const value = String(text || '').replace(/\s+/g, ' ').trim();
    if (!value) return true;
    return /(?:请|麻烦|需要你|你需要|还需要).{0,18}(?:告诉我|提供|补充|明确)/u.test(value)
        || /(?:需要|必须|先).{0,8}(?:你|用户).{0,18}(?:确认|告诉我|提供|补充|明确)/u.test(value)
        || /需要先确认(?:以下|这些|具体|目标|尺寸|素材|规格|风格|信息)/u.test(value)
        || /确认这些信息后|请告诉我|请提供|请补充|哪些是|目标尺寸是多少|有没有参考|风格偏好|你希望.{0,12}哪些模块/u.test(value);
}

function compileConversationalSystemPrompt(
    policyPrompt: string,
    context: AgentContext
): string {
    const items: RuntimeContextItem[] = [{
        id: 'system.conversational',
        kind: 'policy',
        source: 'conversational-agent',
        trust: 'trusted_system',
        slot: 'system_policy',
        content: policyPrompt,
        priority: 100,
        freshness: 'current'
    }];
    if (context.operatingContextSnapshot) {
        items.push(buildOperatingContextRuntimeItem(context.operatingContextSnapshot));
    }
    const compiled = compileRuntimeContext({ items });
    if (context.operatingContextSnapshot
        && !compiled.includedItemIds.includes(OPERATING_CONTEXT_RUNTIME_ITEM_ID)) {
        throw new Error(`operating_context_rejected:${compiled.issues.join(',') || 'unknown'}`);
    }
    return compiled.prompt;
}

export async function tryConversationalModelReplyDetailed(
    context: AgentContext,
    callModel: NonNullable<ProcessOptions['callModel']>,
    options?: ConversationalModelReplyOptions
): Promise<ConversationalModelReplyDetailedResult> {
    const attempts: ConversationalModelFailureAttempt[] = [];
    try {
        const isIntentClarification = Boolean(options?.intentClarification);
        const operatingPhotoshopConnected = context.operatingContextSnapshot
            ? resolveOperatingPhotoshopConnection(context.operatingContextSnapshot)
            : context.isPluginConnected;
        const operatingPhotoshopHasDocument = context.operatingContextSnapshot
            ? resolveOperatingPhotoshopDocumentPresence(context.operatingContextSnapshot)
            : context.photoshopContext?.hasDocument;
        const intentControlPlane = options?.intentControlPlane || buildAgentIntentControlPlaneDecision({
            userInput: context.userInput,
            hasImageInput: Boolean(context.hasAttachedImage || context.attachedImages?.length),
            hasDocument: operatingPhotoshopHasDocument,
            photoshopConnected: operatingPhotoshopConnected
        });
        const planOnlyBoundaryInstruction = buildPlanOnlyConversationBoundaryInstruction(intentControlPlane);
        const replyExtractionOptions: ConversationalModelReplyOptions = {
            ...options,
            allowStructuredPlan: Boolean(planOnlyBoundaryInstruction)
        };
        const shouldStreamDirectResponse = !isCapabilityConversationQuestion(context.userInput);
        const systemPrompt = compileConversationalSystemPrompt([
            buildAgentOperatingProfilePromptSection(),
            isIntentClarification
                ? '当前用户的表达像任务请求，但还缺少足够上下文或执行边界；你要先理解用户想达成什么，再自然地问清最关键的一点。'
                : '当前用户在进行对话咨询，而不是立刻要求你改动 Photoshop 画面。',
            '请像设计师和用户沟通一样，用自然、简洁的中文回答。',
            '先理解用户想要的画面、用途、素材条件和交付物；能直接判断的设计问题，先给出专业判断。',
            '除非用户主动询问设置或故障，不谈模型、索引、工具、能力装载、执行链或系统状态；不要把回复写成工程交接单。',
            '只有用户明确要求开始处理文件时，才说明下一步检查素材、PSD 和版面；本轮只是对话时，不承诺已经修改 Photoshop 画面。',
            '如果用户明确要求不要执行，本轮只回答问题本身。',
            '只有用户明确要求“说明你如何理解某个任务”时，才说明任务理解；不要把概念问题改写成“你想确认我如何理解这件事”。',
            AGENT_RESPONSE_PRESENTATION_PROMPT,
            planOnlyBoundaryInstruction,
            isIntentClarification
                ? '如果需要澄清，只问一个最影响执行的问题；问题要结合用户原话，不要套用“目标、动作、交付结果”这种固定模板。'
                : '',
            '不要输出 JSON，不要模拟工具调用，不要把内部流程名写给用户。',
            buildStandaloneCopyDeliveryInstruction(context, intentControlPlane),
            buildCapabilityConversationInstruction(context),
            '如果用户是在追问上一轮澄清，例如问“比如呢”“具体怎么说”“要补什么”，必须承接最近对话和上一轮澄清，给出可直接发送的表达方式；不要用固定的工具禁用话术代替解释。',
            buildResponseKnowledgePromptSection(context),
            buildProjectFactBoundaryPromptSection(context),
            shouldIncludeRuntimeStateInConversationalReply(context) && !context.operatingContextSnapshot
                ? `当前 Photoshop 连接状态：${context.isPluginConnected ? '已连接' : '未连接'}。`
                : '',
            shouldIncludeProjectContextInConversationalReply(context) && resolveConfirmedProjectImageCount(context) > 0
                ? `当前项目中已扫描到 ${resolveConfirmedProjectImageCount(context)} 张图片；可以基于这些已确认的项目图片数量继续只读分析，但不要推断未读取到的品类、SKU 配置或文档状态。`
                : '',
            options?.clarificationFollowup
                ? [
                    '当前命中“上一轮澄清追问”上下文。',
                    `上一轮用户请求：${options.clarificationFollowup.recentUserRequest || '未记录'}`,
                    `上一轮澄清内容：${options.clarificationFollowup.previousClarification}`,
                    '回答时只解释用户需要补哪些信息，并基于历史语义生成表达示例；不得调用或暗示已经调用 Photoshop。'
                ].join('\n')
                : ''
        ].join('\n'), context);

        const messages = [
            { role: 'system' as const, content: systemPrompt },
            ...buildConversationalPromptHistory(context),
            { role: 'user' as const, content: context.userInput }
        ];

        let result: Awaited<ReturnType<NonNullable<ProcessOptions['callModel']>>>;
        try {
            result = await callModel(messages, {
                temperature: 0.4,
                maxTokens: planOnlyBoundaryInstruction ? 1200 : 900,
                stream: shouldStreamDirectResponse,
                purpose: 'direct_response',
                deferVisibleStream: isCapabilityConversationQuestion(context.userInput)
                    || Boolean(planOnlyBoundaryInstruction)
            });
        } catch (error) {
            attempts.push(buildConversationalModelErrorAttempt('direct_response', error));
            return { reply: null, failure: buildConversationalModelFailure(attempts) };
        }
        const primaryText = String(result?.text || '');
        const primaryReply = extractConversationalReplyFromModelText(primaryText, replyExtractionOptions);
        if (primaryReply && !isRejectedConversationalReplyCandidate(primaryReply, context, intentControlPlane)) {
            await captureExplicitPreferenceFeedback(context, primaryReply, callModel);
            return { reply: primaryReply, repaired: false };
        }
        attempts.push(buildConversationalModelRejectedAttempt('direct_response', primaryText, primaryReply
            ? classifyConversationalReplyRejectionReason(primaryReply, context, intentControlPlane)
            : 'empty_or_unparseable_model_text'));

        let repairResult: Awaited<ReturnType<NonNullable<ProcessOptions['callModel']>>>;
        try {
            repairResult = await callModel(
                [
                    {
                        role: 'system' as const,
                        content: compileConversationalSystemPrompt([
                            buildAgentOperatingProfilePromptSection(),
                            '上一轮对话回复为空、不是自然语言，或误返回了路由/JSON。',
                            '上一轮也可能输出了 <tool_call> 或 <function=...> 这类工具调用格式；这不是可展示回复，必须改成自然语言。',
                            '请基于同一用户问题重新生成一段可直接展示给用户的简体中文自然回复。',
                            '回复必须完整，并按问题的信息量决定篇幅；简单问题保持 1 到 2 句。',
                            AGENT_RESPONSE_PRESENTATION_PROMPT,
                            '像设计师一样先理解用户问题，能直接判断的设计问题先给专业判断。',
                            '如果用户明确要求不要执行，本轮只回答问题本身。',
                            '只有用户明确要求“说明你如何理解某个任务”时，才说明任务理解；不要把概念问题改写成“你想确认我如何理解这件事”。',
                            planOnlyBoundaryInstruction,
                            isIntentClarification
                                ? '当前是澄清回复：可以问一个具体问题，但不要套用固定模板，也不要要求用户一次补齐很多项。'
                                : '不要追问用户补充信息。',
                            '不要输出 JSON，不要模拟工具调用，不要说已经执行 Photoshop。',
                            '如果用户只是询问能力、身份、进度或设计知识，只回答问题本身；不要把能力咨询改写成执行确认。',
                            '能力问答不要写成自我介绍式能力菜单、固定 onboarding 句式、执行前追问或下一步公式；要像设计师聊天一样回答当前问题。',
                            buildResponseKnowledgePromptSection(context),
                            buildCapabilityConversationInstruction(context),
                            buildProjectFactBoundaryPromptSection(context),
                            shouldIncludeRuntimeStateInConversationalReply(context) && !context.operatingContextSnapshot
                                ? `当前 Photoshop 连接状态：${context.isPluginConnected ? '已连接' : '未连接'}。`
                                : ''
                        ].join('\n'), context)
                    },
                    ...buildConversationalPromptHistory(context),
                    { role: 'user' as const, content: context.userInput }
                ],
                {
                    temperature: 0.3,
                    maxTokens: planOnlyBoundaryInstruction ? 1200 : 900,
                    stream: shouldStreamDirectResponse,
                    purpose: 'direct_response_repair',
                    deferVisibleStream: isCapabilityConversationQuestion(context.userInput)
                        || Boolean(planOnlyBoundaryInstruction)
                }
            );
        } catch (error) {
            attempts.push(buildConversationalModelErrorAttempt('direct_response_repair', error));
            return { reply: null, failure: buildConversationalModelFailure(attempts) };
        }
        const repairText = String(repairResult?.text || '');
        const repairedReply = extractConversationalReplyFromModelText(repairText, replyExtractionOptions);
        if (!repairedReply || isRejectedConversationalReplyCandidate(repairedReply, context, intentControlPlane)) {
            const sanitizedRepairedCapabilityReply = repairedReply
                ? tryBuildSanitizedCapabilityReply(repairedReply, context)
                : null;
            const sanitizedPrimaryCapabilityReply = primaryReply
                ? tryBuildSanitizedCapabilityReply(primaryReply, context)
                : null;
            const sanitizedCapabilityReply = sanitizedRepairedCapabilityReply
                || sanitizedPrimaryCapabilityReply;
            if (sanitizedCapabilityReply) {
                await captureExplicitPreferenceFeedback(context, sanitizedCapabilityReply, callModel);
                return { reply: sanitizedCapabilityReply, repaired: true };
            }
            attempts.push(buildConversationalModelRejectedAttempt('direct_response_repair', repairText, repairedReply
                ? classifyConversationalReplyRejectionReason(repairedReply, context, intentControlPlane)
                : 'empty_or_unparseable_model_text'));
            return { reply: null, failure: buildConversationalModelFailure(attempts) };
        }

        await captureExplicitPreferenceFeedback(context, repairedReply, callModel);
        return { reply: repairedReply, repaired: true };
    } catch (error) {
        attempts.push(buildConversationalModelErrorAttempt('direct_response', error));
        return { reply: null, failure: buildConversationalModelFailure(attempts) };
    }
}

export async function tryConversationalModelReply(
    context: AgentContext,
    callModel: NonNullable<ProcessOptions['callModel']>,
    options?: ConversationalModelReplyOptions
): Promise<string | null> {
    const result = await tryConversationalModelReplyDetailed(context, callModel, options);
    return result.reply;
}
