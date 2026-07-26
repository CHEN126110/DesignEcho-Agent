import type { BusinessSkillVisualObservationFeedback } from './business-skill-visual-observation-feedback';
import { getInternalAgentStatusPublicMessage } from './agent-user-visible-state';
import { buildConversationalUnavailableMessage } from './conversational-unavailable-message';

function unwrapStructuredResponse(raw: string): string | null {
    try {
        const json = JSON.parse(raw);
        if (!json || typeof json !== 'object') return null;
        const hasDiagnosticPayload = hasStructuredDiagnosticPayload(json);
        if (typeof json.directResponse === 'string' && json.directResponse.trim()) {
            return containsDeveloperDiagnosticText(json.directResponse) ? '' : json.directResponse.trim();
        }
        if (typeof json.clarificationQuestion === 'string' && json.clarificationQuestion.trim()) {
            return containsDeveloperDiagnosticText(json.clarificationQuestion) ? '' : json.clarificationQuestion.trim();
        }
        if (
            typeof json.message === 'string'
            && json.message.trim()
            && !json.reasoning
            && !json.route
            && !json.skillId
            && !hasDiagnosticPayload
        ) {
            return containsDeveloperDiagnosticText(json.message) ? '' : json.message.trim();
        }
        return '';
    } catch {
        return null;
    }
}

function hasStructuredDiagnosticPayload(value: Record<string, unknown>): boolean {
    const diagnosticKeys = [
        'agentDiagnosticRecord',
        'agentTaskPlan',
        'agentRequestLifecycle',
        'agentIntentDeliberationGate',
        'recordKeys',
        'payloadRedacted',
        'toolCalls'
    ];
    return diagnosticKeys.some((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function containsDeveloperDiagnosticText(value: string): boolean {
    return /\b(agentDiagnosticRecord|agentTaskPlan|agentRequestLifecycle|agentIntentDeliberationGate|matchedSignals|recordKeys|payloadRedacted|tool_call|toolCalls|skillId|direct_response|clarification_needed)\b/i.test(String(value || ''));
}

function containsInternalThinkingLeak(value: string): boolean {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text) return false;
    return containsDeveloperDiagnosticText(text)
        || /<\s*\/?\s*(?:tool_call|function|parameter)\b/i.test(text)
        || /\b(?:createTextLayer|createRectangle|moveLayer|renderLayout|placeImage|describeImage|getDocumentInfo|getLayerHierarchy|saveDocument|operationRequests)\b/i.test(text)
        || /\b(?:inputCoverage|sourceRefs|readiness|declareDesignBrief|declareDesignStrategy|declareActionPlan|skill_manifest|user_goal|readback)\b/i.test(text)
        || /(?:用户指出了校验问题|根据能力要求|声明设计简报|进入阶段计划)/u.test(text)
        || /(?:\b(?:Harness|Runtime(?:\s+Session)?|manifest|schema|tool\s*call|debug\s*trace)\b|能力槽|模型聚合调度|运行时门禁)/iu.test(text)
        || /\b(?:ReAct|Reflexion|Quality\s*Gate|R[0-5])\b/i.test(text)
        || /\b(?:needs|blocked|missing|failed|ready|completed)_[a-z0-9_:-]{2,}\b/i.test(text)
        || /\b(?:route|skillId|toolName|toolCalls|agentTaskPlan|agentDiagnosticRecord|matchedSignals)\s*[:=：]/i.test(text)
        || /\/debug\b/i.test(text)
        || /(?:不要输出|只返回|禁止输出|工具边界|可用的工具|使用可用工具|调用工具|工具来|工具去|工具执行|本轮能力语义|用户这次问到的能力范围|可参考语义范围|执行授权|不是让你现在开始处理文件|可见计划)/u.test(text)
        || /(?:用户让我|用户要求|用户想要|我得|我需要确保|首先[,，\s]*我|接下来我|不能提工具名|不能说已经完成|私有链式思维)/u.test(text);
}

export function looksLikeCannedCapabilityMenu(value: string): boolean {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text) return false;
    const compact = text.replace(/\s+/g, '');
    const cannedOpening = '我可以协助这些设计工作';
    const hasSkuCapability = /SKU.{0,18}(组合图|自选备注|备注图|规格|素材)/i.test(text);
    const hasMainImageCapability = /(主图|点击图|转化图|白底图)/.test(text);
    const hasDetailCapability = /(详情页|长图)/.test(text);
    const hasMenuLikeOpening = /(我可以|我能|可以|支持).{0,12}(协助|帮你|帮助|完成|处理|制作|设计|生成|做)/u.test(text)
        || /(这些|以下|主要).{0,8}(设计工作|能力|任务|方向)/u.test(text);
    const hasMenuLikeNextStep = /(你可以|可以直接|直接).{0,22}(提出|告诉我|说|发起|下达)/u.test(text)
        || /(我会先|我会根据|我再).{0,28}(判断|进入|处理流程|执行方案|设计流程)/u.test(text);
    if (compact.length >= '我可以协助'.length && cannedOpening.startsWith(compact)) return true;
    if (/^我可以协助这些设计工作\s*[:：]?/.test(text)) return true;
    return (
        /我可以协助这些设计工作[:：]/.test(text)
        && /(主图|点击图|转化图)/.test(text)
        && /SKU.{0,12}(组合图|自选备注|备注图)/i.test(text)
    ) || (hasSkuCapability && hasMainImageCapability && hasDetailCapability && hasMenuLikeNextStep)
        || /你可以直接提出主图、SKU、详情页、项目图片理解、文档保存或图层调整需求/.test(text)
        || /我会先判断它属于对话、只读检查还是需要进入处理流程/.test(text);
}

function looksLikeConcreteProjectUnderstanding(value: string): boolean {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text) return false;

    const hasProjectObservationFrame = /(项目资源|资源索引|项目里(?:总)?共有|当前项目包含|文件夹结构|主要文件夹和资源|从结构上看|从文件夹结构来看|资源库已经|素材已初步归类)/u.test(text);
    const hasConcreteResourceObservation = /\d+\s*(?:个|张|类)\s*(?:图片|素材|文件夹|资源)/u.test(text)
        || /`?[^`\s，。；;]+?\.(?:png|jpe?g|psd|psb)`?/iu.test(text)
        || /\bPSD\b|\bPSB\b|SKU\.psb/iu.test(text);
    const hasDesignerJudgment = /(我的判断|我的建议|我观察到|这很可能是|说明这个款式|下一步建议|建议)/u.test(text);
    const looksLikeCapabilityMenu = /(我可以协助这些设计工作|我可以帮你处理以下|我能帮你做的是|你可以直接提出主图、SKU、详情页)/u.test(text);

    return hasProjectObservationFrame
        && hasConcreteResourceObservation
        && hasDesignerJudgment
        && !looksLikeCapabilityMenu;
}

export function looksLikeFormulaicCapabilityExplainer(value: string): boolean {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text) return false;
    if (looksLikeConcreteProjectUnderstanding(text)) return false;

    if (/^会做。SKU\s*主要包括组合图、规格备注和自选备注。?$/iu.test(text)) return true;
    if (/^会做。主图方向主要包括点击图、转化图和白底图。?$/u.test(text)) return true;
    if (/^会做。详情页主要包括长图结构、内容模块和图文排版。?$/u.test(text)) return true;

    const sentenceCount = (text.match(/[。！？!?]/gu) || []).length;
    const hasCannedExplainerOpening = /(常用能力之一|我能帮你做的是|我可以帮你做的是|可以协助你完成的是|我可以帮你处理以下|以下几类工作|简单来说)/u.test(text);
    const hasFixedNextStepFormula = /(你直接说|直接提出|你可以直接告诉|可以直接告诉|告诉我你目前|我先为你规划|我会先读取|我会先看|给你一个执行方案|给你执行方案|出图方案|下一步)/u.test(text);
    const hasSkuDeliveryTerms = /(SKU|组合图|自选备注|规格)/iu.test(text);
    const hasEnumeratedCapabilityList = hasSkuDeliveryTerms
        && /(以下几类工作|几类工作|主要包括|包括以下|可以帮你处理|可以帮你完成)/u.test(text)
        && /(^|\s|\n)\d+[.、]/u.test(text);
    const hasCrossDomainCapabilityMenu = hasSkuDeliveryTerms
        && /(主图|点击图|转化图|白底图|详情页|长图)/u.test(text)
        && /(可以|协助|支持|能力|设计工作|直接提出|处理流程|执行方案)/u.test(text);
    const hasMenuLikeCrossDomainFraming = hasCannedExplainerOpening
        || hasFixedNextStepFormula
        || /(^|\s|\n)\d+[.、]/u.test(text)
        || /(你可以直接提出|我会先判断|处理流程|执行方案|能力菜单|能力清单)/u.test(text);
    const hasProcessFormula = hasSkuDeliveryTerms
        && /(项目资料|项目素材|素材和配置|素材情况|规格配置|模板结构|执行方案|出图方案|排版样式|处理流程)/u.test(text)
        && /(你直接|直接说|直接告诉|下一步|我会先|我先为你|我再进入|真正执行时|发给我)/u.test(text);

    if (hasCannedExplainerOpening && hasFixedNextStepFormula) return true;
    if (hasEnumeratedCapabilityList && hasFixedNextStepFormula) return true;
    if (hasCrossDomainCapabilityMenu && hasMenuLikeCrossDomainFraming) return true;
    if (text.length >= 110 && sentenceCount >= 2 && hasProcessFormula) return true;
    return text.length >= 120
        && sentenceCount >= 3
        && hasSkuDeliveryTerms
        && /(执行方案|出图方案|项目资料|项目素材|素材情况|你直接说|直接提出|直接告诉|发给我)/u.test(text);
}

function looksLikeCapabilityExecutionPromise(value: string): boolean {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text) return false;
    if (!/^(?:会做|会的|可以|当然可以|我可以|我能|支持)/u.test(text)) return false;

    const hasSkuCapability = /(SKU|组合图|自选备注|规格备注|规格图)/iu.test(text);
    if (!hasSkuCapability) return false;

    return /(实际制作时|制作时|真正制作时|真正执行时|需要制作时).{0,50}(读取|调用|当前项目|项目素材|项目资料|配置|模板|规格|PSD|PSB|导出|高效完成|进入|处理流程|规划)/iu.test(text)
        || /(读取|调用).{0,12}(当前项目|项目).{0,30}(素材|资料|配置|模板|规格|PSD|PSB)/iu.test(text)
        || /(你说|直接说).{0,18}(帮我做\s*SKU|做\s*SKU).{0,28}(进入|处理|规划|读取)/iu.test(text)
        || /(进入|再进入).{0,12}(处理流程|受控处理流程)/u.test(text)
        || /(为你制作|处理素材导出|高效完成|确保输出).{0,30}(SKU|组合图|自选备注|规格图|素材|导出)/iu.test(text);
}

function looksLikeInternalPromptInstructionLeak(value: string): boolean {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text) return false;
    return /本轮能力语义|用户这次问到的能力范围|本轮是(?:单项|总体)能力咨询|执行授权|不是让你现在开始处理文件|工具边界不是思维边界|工具只承担定义清晰|不要输出\s*JSON|不要模拟工具调用|不要输出工具名|可参考语义范围/u.test(text);
}

function removeToolCallMarkup(content: string): string {
    let text = String(content || '');
    text = text
        .replace(/<\s*tool_call\b[^>]*>[\s\S]*?<\s*\/\s*tool_call\s*>/gi, '')
        .replace(/<\s*function\s*=[^>]*>[\s\S]*?<\s*\/\s*function\s*>/gi, '')
        .replace(/<\s*parameter\s*=[^>]*>[\s\S]*?<\s*\/\s*parameter\s*>/gi, '');
    const partialTagIndex = text.search(/<\s*(?:tool_call|function|parameter)\b/gi);
    if (partialTagIndex >= 0) {
        text = text.slice(0, partialTagIndex);
    }
    return text
        .replace(/<\s*\/?\s*(?:tool_call|function|parameter)\b[^>]*>/gi, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

const CONVERSATIONAL_MODEL_UNAVAILABLE_MESSAGE = buildConversationalUnavailableMessage({ audience: 'general', kind: 'unknown' });
const CONVERSATIONAL_CAPABILITY_MODEL_UNAVAILABLE_MESSAGE = buildConversationalUnavailableMessage({ audience: 'capability', kind: 'unknown' });
const OPEN_DESIGN_CLARIFICATION_MESSAGE = '开放式设计需要先确认重点、可改范围，以及是否基于当前 Photoshop 文档处理；确认后再继续。';
const PROJECT_IMAGES_UNAVAILABLE_MESSAGE = '当前项目里没有可分析的图片资源。';

const INTERNAL_FAILURE_MESSAGES: Record<string, string> = {
    'conversational reply unavailable': getInternalAgentStatusPublicMessage('conversational reply unavailable') || CONVERSATIONAL_MODEL_UNAVAILABLE_MESSAGE,
    needs_model_design_decision: getInternalAgentStatusPublicMessage('needs_model_design_decision') || '需要先确认画面重点、素材取舍和结果检查方式；本轮不会直接改动画面。',
    needs_visual_observation: getInternalAgentStatusPublicMessage('needs_visual_observation') || '需要先确认项目视觉素材和设计方向，再继续处理。',
    'no project images available': PROJECT_IMAGES_UNAVAILABLE_MESSAGE,
    'skill disabled': getInternalAgentStatusPublicMessage('skill disabled') || '这个操作暂时还不能直接完成；本轮不会改动画面。',
    'skill executor not found': getInternalAgentStatusPublicMessage('skill executor not found') || '这个操作暂时还不能直接完成；本轮不会改动画面。',
    'font replacement needs layout review': '字体已写入，但文本边界变化明显，需要复核或继续调整排版后才能算完成。',
    'font replacement changed typography metrics': '字体已写入，但版面复核发现字号、字距或行距发生非预期变化。'
};

const CONVERSATIONAL_MODEL_AUTH_FAILURE_MESSAGE = buildConversationalUnavailableMessage({ audience: 'general', kind: 'auth' });
const WHITE_BACKGROUND_EXPORT_FAILURE_MESSAGE = '白底图没有导出成功。Photoshop 可能正被弹窗或面板状态阻塞，本轮未继续改动画面；请关闭弹窗或等待面板恢复后再重试。';
const WHITE_BACKGROUND_EXPORT_SUCCESS_MESSAGE = '白底图已导出到项目主图目录。这一步只处理白底图素材，整套主图排版和设计仍需要单独完成。';
const PHOTOSHOP_PLUGIN_CONNECTION_MESSAGE = 'Photoshop 插件还没有连上。请在 PS 中打开 DesignEcho 插件面板，确认顶部显示已连接后再试。';

function normalizeFailureKey(value: string): string {
    return value.trim().toLowerCase();
}

function looksLikeInternalStatusCode(value: string): boolean {
    const text = value.trim();
    return /^[a-z][a-z0-9_:-]{2,}$/i.test(text) && /[_:-]/.test(text);
}

function redactLocalPaths(value: string): string {
    return value
        .replace(/[A-Za-z]:[\\/][^\r\n"'<>|，。；;]+/g, '[local-path-redacted]')
        .replace(/\b[A-Za-z]:\/[^\r\n"'<>|，。；;]+/g, '[local-path-redacted]')
        .replace(/\[local-path-redacted\](?:\s*\[local-path-redacted\])+/g, '[local-path-redacted]');
}

const INLINE_INTERNAL_DIAGNOSTIC_PATTERN = /\b(?:direct_response|ready_direct_response|clarification_needed|blocked_needs_clarification|tool_call_failed(?::[a-z0-9_:-]+)?|blocked_[a-z0-9_:-]+|needs_model_design_decision|needs_visual_observation|Conversational reply unavailable)\b/i;
const INLINE_INTERNAL_DIAGNOSTIC_STRIP_PATTERN = /\b(?:direct_response|ready_direct_response|clarification_needed|blocked_needs_clarification|tool_call_failed(?::[a-z0-9_:-]+)?|blocked_[a-z0-9_:-]+|needs_model_design_decision|needs_visual_observation|Conversational reply unavailable)\b/gi;

function stripInlineInternalDiagnostics(value: string): string {
    return String(value || '')
        .replace(INLINE_INTERNAL_DIAGNOSTIC_STRIP_PATTERN, '')
        .replace(/\[local-path-redacted\]/g, '')
        .replace(/\s+/g, ' ')
        .replace(/^[,，。；;:：\-\s]+|[,，。；;:：\-\s]+$/g, '')
        .trim();
}

function looksLikeStructuredRouterPayload(value: string): boolean {
    const text = value.trim();
    return (
        (text.startsWith('{') || text.startsWith('```json'))
        && /"?(route|skillId|toolCalls|directResponse|clarificationQuestion)"?\s*:/i.test(text)
    );
}

const INTERNAL_STATUS_ONLY_PATTERN = /^(?:direct_response|ready_direct_response|clarification_needed|blocked_needs_clarification|needs_model_design_decision|needs_visual_observation|conversational reply unavailable|tool_call_failed(?::[a-z0-9_:-]+)?|blocked_[a-z0-9_:-]+|photoshop_not_connected|photoshop_document_required|sku document not found|skill disabled|skill executor not found)$/i;
const SILENT_INTERNAL_ROUTE_STATUS_PATTERN = /^(?:(?:错误|error|status|状态|route|路由|reason|原因|diagnostic|诊断)\s*[:=：]\s*)?(?:direct_response|ready_direct_response|clarification_needed|blocked_needs_clarification)$/i;

function isSilentInternalRouteStatus(value: string): boolean {
    return SILENT_INTERNAL_ROUTE_STATUS_PATTERN.test(value.trim());
}

function looksLikeStandaloneInternalDiagnostic(value: string): boolean {
    const text = value.trim();
    if (!text) return false;
    if (INTERNAL_FAILURE_MESSAGES[normalizeFailureKey(text)]) return true;
    if (INTERNAL_STATUS_ONLY_PATTERN.test(text)) return true;
    if (looksLikeInternalStatusCode(text)) return true;

    const labeled = text.match(/^(?:错误|error|status|状态|route|路由|reason|原因|diagnostic|诊断)\s*[:=：]\s*(.+)$/i);
    if (!labeled) return false;

    const payload = labeled[1].trim();
    return INTERNAL_STATUS_ONLY_PATTERN.test(payload) || looksLikeInternalStatusCode(payload);
}

function mapStandaloneInternalDiagnosticForAssistantBody(value: string): string {
    const text = String(value || '').trim();
    if (!text || isSilentInternalRouteStatus(text)) return '';
    if (/^(?:needs_model_design_decision|needs_visual_observation|photoshop_not_connected|photoshop_document_required|skill disabled|skill executor not found)$/i.test(text)) {
        return mapInternalDiagnosticPrefix(text);
    }
    return '';
}

function appendRedactionMarkerIfNeeded(message: string, source: string): string {
    return source.includes('[local-path-redacted]') && !message.includes('[local-path-redacted]')
        ? `${message} [local-path-redacted]`
        : message;
}

function mapInternalDiagnosticPrefix(value: string): string {
    const normalized = normalizeFailureKey(value);
    for (const [key, message] of Object.entries(INTERNAL_FAILURE_MESSAGES)) {
        if (!normalized.startsWith(key)) continue;
        const remainder = normalized.slice(key.length).trim();
        if (!remainder
            || value.includes('[local-path-redacted]')
            || /^(?::|：)?\s*(?:tool_call_failed|blocked_|needs_|photoshop_|skill_|[a-z]+_[a-z0-9_:-]+)/i.test(remainder)) {
            return appendRedactionMarkerIfNeeded(rewriteUserFacingOperationTerms(message), value);
        }
    }

    const statusMatch = value.match(/^(?:tool_call_failed(?::[a-z0-9_:-]+)?|blocked_[a-z0-9_:-]+|needs_model_design_decision|needs_visual_observation|photoshop_not_connected|photoshop_document_required)\b/i);
    if (!statusMatch) return '';

    const publicStatusMessage = getInternalAgentStatusPublicMessage(statusMatch[0])
        || getInternalAgentStatusPublicMessage(value);
    return publicStatusMessage
        ? appendRedactionMarkerIfNeeded(rewriteUserFacingOperationTerms(publicStatusMessage), value)
        : '';
}

function extractInternalStatusCode(value: string): string {
    const text = value.trim();
    if (!looksLikeStandaloneInternalDiagnostic(text)) return '';

    const directMapped = INTERNAL_FAILURE_MESSAGES[normalizeFailureKey(text)];
    if (directMapped || looksLikeInternalStatusCode(text)) return text;

    const explicitStatusMatch = text.match(/\b(?:direct_response|clarification_needed|needs_model_design_decision|needs_visual_observation|conversational reply unavailable|tool_call_failed|blocked_[a-z0-9_:-]+)\b/i);
    if (explicitStatusMatch) return explicitStatusMatch[0];

    const statusMatch = text.match(/\b(?:agent|tool|blocked|needs|missing|skill|conversational)[a-z0-9_:-]{2,}\b/i);
    return statusMatch ? statusMatch[0] : '';
}

function rewriteInternalAssetVocabulary(value: string): string {
    return String(value || '')
        .replace(/\bassetNature\b/gi, '素材类型')
        .replace(/\bfinished[_-]design\b/gi, '成品设计图')
        .replace(/\braw[_-]photo\b/gi, '项目原片')
        .replace(/\braw[_-]model[_-]wear\b/gi, '模特实拍图')
        .replace(/\braw[_-]product[_-]still\b/gi, '产品实拍图')
        .replace(/\braw[_-]detail[_-]closeup\b/gi, '细节实拍图')
        .replace(/\bcolor[_-]single\b/gi, '单色款式图')
        .replace(/\bsku[_-]material\b/gi, 'SKU 素材图')
        .replace(/\bsku[_-]output\b/gi, 'SKU 成品图');
}

function rewriteUserFacingOperationTerms(value: string): string {
    return rewriteInternalAssetVocabulary(value)
        .replace(/\bRuntime\s+Session\s*的\s*R5\s*尚未通过[（(][^）)]*[）)]，不能把工具结果声明为任务完成。?/giu, '本轮处理已经结束，但最终画面还没有完成复核，暂时不能确认任务已经完成。')
        .replace(/\bRuntime\s+Session\s*的\s*E2\s*尚无真实交付结果[（(][^）)]*[）)]，不能声明任务完成。?/giu, '最终画面已经完成复核，但交付结果还没有验收，暂时不能确认任务已经完成。')
        .replace(/当前处理\s*的\s*当前阶段\s*尚未通过[（(][^）)]*[）)]，不能把工具结果声明为任务完成。?/gu, '本轮处理已经结束，但最终画面还没有完成复核，暂时不能确认任务已经完成。')
        .replace(/【?布局分析\/主逻辑】?能力槽/g, '主模型设置')
        .replace(/【?视觉分析】?能力槽/g, '视觉模型设置')
        .replace(/能力槽/g, '模型设置')
        .replace(/模型聚合调度/g, '模型分工')
        .replace(/\bRuntime\s+Session\b/gi, '当前处理')
        .replace(/\bRuntime\b/gi, '处理过程')
        .replace(/\bHarness\b/gi, '内部检查')
        .replace(/新图层的\s*ID\s*为\s*\d+/gi, '新复制层已确认')
        .replace(/`?layerId`?\s*(?:为|:|：|=)\s*\d+/gi, '对应图层')
        .replace(/\(\s*layerId\s*[:：]\s*\d+\s*\)/gi, '')
        .replace(/\blayerId\b/gi, '对应图层')
        .replace(/\btargetGroupId\b/gi, '目标图层组')
        .replace(/\bgroupId\b/gi, '图层组')
        .replace(/\btool_calls?\b/gi, '画面处理')
        .replace(/\bReAct\b/gi, '边看边处理')
        .replace(/\bReflexion\b/gi, '复盘调整')
        .replace(/\bQuality\s*Gate\b/gi, '结果复核')
        .replace(/\bR5\b/g, '最终复核')
        .replace(/\bE2\b/g, '交付验收')
        .replace(/\bR[0-5]\b/g, '当前阶段')
        .replace(/\bunobserved\b/gi, '尚未复核')
        .replace(/\bSkill\b/g, '能力')
        .replace(/\bskill\b/g, '能力')
        .replace(/\bMarkdown\b/g, '文本')
        .replace(/执行状态/g, '处理状态')
        .replace(/工具预算/g, '本轮处理上限')
        .replace(/模型总结/g, '结果说明')
        .replace(/模型停止调用工具/g, '本轮没有形成最终说明')
        .replace(/工具调用/g, '画面处理')
        .replace(/工具返回/g, '处理返回')
        .replace(/所有处理步骤均未成功/g, '这次还没做出有效的东西')
        .replace(/处理步骤/g, '处理')
        .replace(/最后错误/g, '最后问题')
        .replace(/任务完成契约/g, '完成条件')
        .replace(/不作为完成结论/g, '不会当作完成结论')
        .replace(/工具\s*路径/g, '处理过程')
        .replace(/工具\s*循环/g, '处理过程')
        .replace(/业务\s*Skill/g, '设计任务')
        .replace(/业务\s*skill/gi, '设计任务')
        .replace(/受控\s*执行/g, '确认范围内处理')
        .replace(/执行\s*器/g, '处理流程')
        .replace(/\brenderLayout\b/g, '排版画面')
        .replace(/\bdescribeImage\b/g, '理解图片')
        .replace(/\bgetDocumentInfo\b/g, '读取文档信息')
        .replace(/\blistDocuments\b/g, '检查设计文档')
        .replace(/\bswitchDocument\b/g, '切换文档')
        .replace(/\bgetLayerHierarchy\b/g, '读取图层结构')
        .replace(/\bgetLayerProperties\b/g, '读取图层属性')
        .replace(/\bgetAcceptanceSnapshot\b/g, '读取验收快照')
        .replace(/\bgetDetailPageDesignFramework\b/g, '读取详情页方法')
        .replace(/\bplaceImage\b/g, '置入图片')
        .replace(/\bsaveDocument\b/g, '保存文件')
        .replace(/\bcreateDocument\b/g, '创建文档')
        .replace(/\bcreateGroup\b/g, '创建图层组')
        .replace(/\bcreateRectangle\b/g, '创建矩形')
        .replace(/\bcreateTextLayer\b/g, '创建文本图层')
        .replace(/\brenameLayer\b/g, '重命名图层')
        .replace(/\bmoveLayerToGroup\b/g, '移动到图层组')
        .replace(/\bduplicateLayer\b/g, '复制图层')
        .replace(/\bdeleteLayer\b/g, '删除图层')
        .replace(/\bfocusLayer\b/g, '聚焦图层')
        .replace(/\bquickExport\b/g, '快速导出')
        .replace(/结果检查标准/g, '结果检查方式')
        .replace(/检查标准/g, '检查方式')
        .replace(/诊断信息供排查/g, '处理细节已收起');
}

function mapImplementationFacingPreflightText(value: string): string {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text) return '';

    if (/我需要先确定这次设计的方向/.test(text)
        && /(画面重点|效果检查方式|开始改动画面)/.test(text)) {
        return getInternalAgentStatusPublicMessage('needs_model_design_decision')
            || '需要先确认画面重点、素材取舍和结果检查方式；本轮不会直接改动画面。';
    }

    if (/形成清晰的设计计划/.test(text)
        && /Photoshop\s*写入/.test(text)
        && /模型或人工/.test(text)
        && /设计决策/.test(text)) {
        return getInternalAgentStatusPublicMessage('needs_model_design_decision')
            || '需要先确认画面重点、素材取舍和结果检查方式；本轮不会直接改动画面。';
    }

    if (/确认项目视觉素材和设计方向/.test(text)
        && /Photoshop\s*写入/.test(text)
        && /视觉素材理解/.test(text)) {
        return getInternalAgentStatusPublicMessage('needs_visual_observation')
            || '需要先确认项目视觉素材和设计方向，再继续处理。';
    }

    if (/设计执行前检查未通过/.test(text) && /Photoshop\s*写入/.test(text)) {
        return '需要先补齐会影响设计结果的条件，再继续处理。';
    }

    return '';
}

function looksLikePhotoshopBridgeConnectionFailure(value: string): boolean {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text) return false;
    return /Error invoking remote method ['"]?ws:send['"]?/i.test(text)
        || /UXP\s*插件未连接/i.test(text)
        || (/插件未连接/.test(text) && /(UXP|Photoshop|PS|ws:send|remote method|文档列表|listDocuments)/i.test(text))
        || (/ws:send/i.test(text) && /(Error invoking|UXP|插件|Photoshop|listDocuments|文档列表)/i.test(text));
}

export function sanitizeUserVisibleAgentText(content: string): string {
    if (!content) return content;

    const trimmed = String(content).trim();
    if (looksLikeCannedCapabilityMenu(trimmed)) return '';
    if (looksLikeFormulaicCapabilityExplainer(trimmed)) return '';
    if (looksLikeCapabilityExecutionPromise(trimmed)) return '';
    if (looksLikeInternalPromptInstructionLeak(trimmed)) return '';
    if (looksLikeStructuredRouterPayload(trimmed)) {
        const cleanedStructured = cleanAssistantResponseContent(trimmed).trim();
        if (!cleanedStructured || looksLikeStructuredRouterPayload(cleanedStructured)) return '';
        return rewriteUserFacingOperationTerms(cleanedStructured);
    }

    return rewriteUserFacingOperationTerms(cleanAssistantResponseContent(content));
}

export function sanitizeUserVisibleAssistantBodyText(content: string): string {
    const rawText = String(content || '').trim();
    if (looksLikeStandaloneInternalDiagnostic(rawText)) {
        return mapStandaloneInternalDiagnosticForAssistantBody(rawText);
    }

    const agentVisibleText = sanitizeUserVisibleAgentText(content).trim();
    if (!agentVisibleText) return '';
    if (looksLikeStandaloneInternalDiagnostic(agentVisibleText)) {
        return mapStandaloneInternalDiagnosticForAssistantBody(agentVisibleText);
    }
    // 正文可能是多行 markdown（标题/表格/列表），必须保留换行，否则渲染层会把结构压成一坨。
    // 脱敏与术语改写照常生效，只是不再折叠换行。
    return sanitizeUserVisibleDiagnosticText(agentVisibleText, { preserveNewlines: true }) || agentVisibleText;
}

function looksLikeEnglishDominantRuntimeMonologue(value: string): boolean {
    const cjkCount = value.match(/[\u3400-\u9fff]/gu)?.length || 0;
    const latinCount = value.match(/[a-z]/giu)?.length || 0;
    if (cjkCount === 0 && latinCount >= 3) return true;
    if (cjkCount < 2 && latinCount >= 16) return true;
    if (latinCount > Math.max(60, cjkCount * 5)) return true;
    return latinCount > 40
        && /\b(?:the current document|the system is blocking|i need to|let me|the error says)\b/iu.test(value);
}

function stripLeadingEnglishThinkingNarration(value: string): string {
    const firstCjkIndex = value.search(/[\u3400-\u9fff]/u);
    if (firstCjkIndex <= 0) return value;
    const prefix = value.slice(0, firstCjkIndex).replace(/[*_`#：:·.-]+/gu, ' ').trim();
    if (!/^(?:the\s+the\s+place|the\s+place|from\s+the\s+snapshot|looking(?:\s+i\s+need\s+to\s+provide)?|now\s+i\s+need\s+to|first\s+blue)\b/iu.test(prefix)) {
        return value;
    }
    return value
        .slice(firstCjkIndex)
        .trim()
        .replace(/^([^*：:\n]{1,24})\*{1,2}(?=[:：])/u, '$1');
}

function looksLikeMechanicalThinkingNarration(value: string): boolean {
    return /\b[a-z]+(?:[A-Z][A-Za-z0-9]+)+\b/u.test(value)
        || /(?:现在|接下来|首先).{0,18}(?:搜索|调用|创建第|置入第|切换文档|获取快照)/u.test(value)
        || /第[一二三四五六七八九十\d]+个.{0,20}(?:创建成功|已创建).{0,30}(?:现在|接下来).{0,16}(?:创建|置入)/u.test(value);
}

function looksLikeRunawayThinkingRepetition(value: string): boolean {
    const sentenceCounts = new Map<string, number>();
    const sentences = value
        .toLowerCase()
        .split(/[。！？!?；;\n]+/u)
        .map((sentence) => sentence.replace(/\s+/g, ' ').trim())
        .filter((sentence) => sentence.length >= 12);
    for (const sentence of sentences) {
        const count = (sentenceCounts.get(sentence) || 0) + 1;
        if (count >= 3) return true;
        sentenceCounts.set(sentence, count);
    }

    const englishWords = value.toLowerCase().match(/[a-z]+/gu) || [];
    const phraseCounts = new Map<string, number>();
    for (let index = 0; index + 5 < englishWords.length; index += 1) {
        const phrase = englishWords.slice(index, index + 6).join(' ');
        const count = (phraseCounts.get(phrase) || 0) + 1;
        if (count >= 4) return true;
        phraseCounts.set(phrase, count);
    }
    return false;
}

export function sanitizeUserVisibleThinkingText(content: string): string {
    const rawText = stripLeadingEnglishThinkingNarration(String(content || '').trim());
    if (!rawText) return '';
    if (containsInternalThinkingLeak(rawText)) return '';
    if (looksLikeMechanicalThinkingNarration(rawText)) return '';
    if (looksLikeEnglishDominantRuntimeMonologue(rawText)) return '';
    if (looksLikeRunawayThinkingRepetition(rawText)) return '';

    const cleaned = sanitizeUserVisibleAgentText(rawText).trim();
    if (!cleaned) return '';
    if (containsInternalThinkingLeak(cleaned)) return '';
    if (looksLikeMechanicalThinkingNarration(cleaned)) return '';
    if (looksLikeStandaloneInternalDiagnostic(cleaned)) return '';
    if (looksLikeEnglishDominantRuntimeMonologue(cleaned)) return '';
    if (looksLikeRunawayThinkingRepetition(cleaned)) return '';
    return cleaned;
}

export function finalizeUserVisibleThinkingText(
    content: string,
    options?: { requireSentenceBoundary?: boolean }
): string {
    const cleaned = sanitizeUserVisibleThinkingText(content).trim();
    if (!cleaned) return '';
    if (/[。！？!?；;…][\s"'）】》]*$/u.test(cleaned)) return cleaned;

    let lastSentenceEnd = -1;
    for (let index = 0; index < cleaned.length; index += 1) {
        if (/[。！？!?；;…]/u.test(cleaned[index])) {
            lastSentenceEnd = index;
        }
    }
    if (lastSentenceEnd >= 0) {
        return cleaned.slice(0, lastSentenceEnd + 1).trim();
    }

    // Provider thinking delta 是不断增长的累计快照。只有完整句子才可以发布；
    // 否则诸如“错误分析：\n- `input...”的前缀会先进入 UI，即使完整文本
    // 随后被判定为内部诊断，也无法撤回已经显示的半句。
    if (options?.requireSentenceBoundary) return '';

    if (/(?:当前|因此|所以|然后|接下来|下一步|需要|准备|正在|并且|但是|由于|如果|通过|基于)$/u.test(cleaned)) {
        return '';
    }
    return cleaned;
}

export function sanitizeUserVisibleDiagnosticText(
    value?: string,
    options?: { preserveNewlines?: boolean }
): string {
    // 默认把所有空白（含换行）压成单空格——适合单行诊断状态文本。
    // preserveNewlines=true 时只压行内水平空白、保留换行——供多行 markdown 正文使用，
    // 否则模型输出的标题/表格/段落结构会被压成一行、无法正确渲染。
    const redacted = redactLocalPaths(removeToolCallMarkup(String(value || '')));
    const cleaned = (options?.preserveNewlines
        ? redacted.replace(/\r\n?/g, '\n').replace(/[^\S\n]+/g, ' ').replace(/[ \t]+\n/g, '\n')
        : redacted.replace(/\s+/g, ' ')
    ).trim();
    if (!cleaned) return '';
    if (isSilentInternalRouteStatus(cleaned)) return '';

    if (looksLikePhotoshopBridgeConnectionFailure(cleaned)) {
        return PHOTOSHOP_PLUGIN_CONNECTION_MESSAGE;
    }

    const preflightText = mapImplementationFacingPreflightText(cleaned);
    if (preflightText) return rewriteUserFacingOperationTerms(preflightText);

    const hasExplicitConversationalAuthSignal = /(鉴权失败|认证失败|API\s*Key|Invalid\s+API\s+Key|401|unauthorized)/i.test(cleaned);
    const looksLikeConversationalUnavailable = /^Conversational reply unavailable$/i.test(cleaned)
        || /\bConversational reply unavailable\b/i.test(cleaned)
        || /(当前对话服务还不能稳定回答|暂时没有拿到(?:可靠|稳定)回复|暂时无法生成自然回复|对话模型没有返回有效内容|当前没有生成可展示回复|没有收到模型回复|没有拿到模型回复)/u.test(cleaned)
        || /(当前对话模型连接不可用|负责自然对话的模型|自然对话的模型|AI\s*对话服务|AI\s*连接)/i.test(cleaned)
        || /(不能生成自然的能力回答|不能可靠回答这个能力问题|我会重新组织可读回复)/u.test(cleaned);
    if (hasExplicitConversationalAuthSignal && looksLikeConversationalUnavailable) {
        return CONVERSATIONAL_MODEL_AUTH_FAILURE_MESSAGE;
    }
    if (looksLikeConversationalUnavailable) {
        return CONVERSATIONAL_MODEL_UNAVAILABLE_MESSAGE;
    }

    if (/开放式设计执行/.test(cleaned)
        && /(模型明确放行|路由信号|足够路由信号)/.test(cleaned)) {
        return OPEN_DESIGN_CLARIFICATION_MESSAGE;
    }

    if (/(当前)?对话模型(鉴权失败|连接未通过)|API Key|Invalid API Key|401|unauthorized/i.test(cleaned)
        && /对话模型|AI\s*(?:对话服务|连接)|conversation|conversational|自然回复|API Key|401|unauthorized/i.test(cleaned)) {
        return CONVERSATIONAL_MODEL_AUTH_FAILURE_MESSAGE;
    }

    if (/当前没有生成可展示回复/u.test(cleaned)
        && /当前还缺少关键信息|缺少关键信息|empty_conversational_reply/i.test(cleaned)) {
        return CONVERSATIONAL_MODEL_UNAVAILABLE_MESSAGE;
    }

    if (/白底图/.test(cleaned) && /(exportWhiteBgFromSkuMaterial|来源=\[local-path-redacted\]|工具=|读回=)/i.test(cleaned)) {
        return /失败|超时|阻塞|error/i.test(cleaned)
            ? WHITE_BACKGROUND_EXPORT_FAILURE_MESSAGE
            : WHITE_BACKGROUND_EXPORT_SUCCESS_MESSAGE;
    }

    const mapped = INTERNAL_FAILURE_MESSAGES[normalizeFailureKey(cleaned)];
    if (mapped) return rewriteUserFacingOperationTerms(mapped);

    const prefixedInternalDiagnostic = mapInternalDiagnosticPrefix(cleaned);
    if (prefixedInternalDiagnostic) return prefixedInternalDiagnostic;

    const embeddedInternalDiagnostic = getInternalAgentStatusPublicMessage(cleaned);
    if (embeddedInternalDiagnostic
        && /\b(?:tool_call_failed|blocked_[a-z0-9_:-]+|[a-z0-9_:-]*_blocked|needs_model_design_decision|needs_visual_observation)\b/i.test(cleaned)) {
        return appendRedactionMarkerIfNeeded(rewriteUserFacingOperationTerms(embeddedInternalDiagnostic), cleaned);
    }

    if (looksLikeStandaloneInternalDiagnostic(cleaned)) {
        const publicStatusMessage = getInternalAgentStatusPublicMessage(cleaned);
        if (publicStatusMessage) return rewriteUserFacingOperationTerms(publicStatusMessage);

        const internalStatus = extractInternalStatusCode(cleaned);
        if (internalStatus && isSilentInternalRouteStatus(internalStatus)) return '';
        if (internalStatus) {
            const mappedStatus = INTERNAL_FAILURE_MESSAGES[normalizeFailureKey(internalStatus)]
                || getInternalAgentStatusPublicMessage(internalStatus);
            // 未知状态只用于开发诊断。这里不能把它臆测为“用户缺信息”，
            // 否则后续 failure formatter 已经无法区分真正的输入缺失和运行时未推进。
            return mappedStatus ? rewriteUserFacingOperationTerms(mappedStatus) : '';
        }
    }

    if (INLINE_INTERNAL_DIAGNOSTIC_PATTERN.test(cleaned)) {
        const stripped = stripInlineInternalDiagnostics(cleaned);
        return stripped ? rewriteUserFacingOperationTerms(stripped) : '';
    }

    return rewriteUserFacingOperationTerms(cleaned);
}

export function cleanAssistantFailureErrorText(error?: string): string {
    const cleaned = sanitizeUserVisibleDiagnosticText(error);
    if (!cleaned) return '';
    if (cleaned === PHOTOSHOP_PLUGIN_CONNECTION_MESSAGE) return cleaned;
    if (Object.values(INTERNAL_FAILURE_MESSAGES).includes(cleaned)) return cleaned;

    const mapped = INTERNAL_FAILURE_MESSAGES[normalizeFailureKey(cleaned)];
    if (mapped) return mapped;

    if (looksLikeInternalStatusCode(cleaned)) {
        // 未知的内部状态码不能被 UI 臆测为“用户缺信息”。
        // 有明确公开映射时展示；否则保留主结果文案，状态码只用于诊断。
        return getInternalAgentStatusPublicMessage(cleaned) || '';
    }

    if (looksLikeUserFacingFailureDetail(cleaned)) return cleaned;

    return `错误: ${cleaned}`;
}

export function cleanAssistantFailureMessageText(message?: string): string {
    const cleaned = sanitizeUserVisibleDiagnosticText(String(message || '')).trim();
    if (!cleaned) return '处理失败';
    if (Object.values(INTERNAL_FAILURE_MESSAGES).includes(cleaned)) return cleaned;

    const mapped = INTERNAL_FAILURE_MESSAGES[normalizeFailureKey(cleaned)];
    if (mapped) return mapped;

    if (looksLikeInternalStatusCode(cleaned)) {
        return getInternalAgentStatusPublicMessage(cleaned) || '';
    }

    return cleaned;
}

function normalizeComparableFailureText(value: string): string {
    return String(value || '')
        .replace(/^⚠️\s*/, '')
        .replace(/^(?:错误|Error)\s*[:：]\s*/i, '')
        .replace(/\s+/g, '')
        .trim();
}

function isRedundantFailureDetail(base: string, detail: string): boolean {
    const normalizedBase = normalizeComparableFailureText(base);
    const normalizedDetail = normalizeComparableFailureText(detail);
    if (!normalizedBase || !normalizedDetail) return false;
    if (normalizedBase.includes('接不上AI对话服务') && normalizedDetail.includes('接不上AI对话服务')) {
        return true;
    }
    if (normalizedBase.includes('暂时没拿到可靠回复') && normalizedDetail.includes('暂时没拿到可靠回复')) {
        return true;
    }
    if (normalizedBase.includes('暂时没有拿到可靠回复') && normalizedDetail.includes('暂时没有拿到可靠回复')) {
        return true;
    }
    if (normalizedBase.includes('暂时没有拿到稳定回复') && normalizedDetail.includes('暂时没有拿到可靠回复')) {
        return true;
    }
    if (normalizedBase.includes('暂时没有拿到可靠回复') && normalizedDetail.includes('暂时没有拿到稳定回复')) {
        return true;
    }
    if (normalizedBase.includes('暂时没有拿到可靠的能力说明') && normalizedDetail.includes('暂时没有拿到可靠回复')) {
        return true;
    }
    if (normalizedBase.includes('暂时没有拿到可靠回复') && normalizedDetail.includes('暂时没有拿到可靠的能力说明')) {
        return true;
    }
    if (normalizedBase.includes('当前对话服务还不能稳定回答') && normalizedDetail.includes('当前对话服务还不能稳定回答')) {
        return true;
    }
    if (normalizedBase.includes('现在没能生成有效回复') && normalizedDetail.includes('现在没能生成有效回复')) {
        return true;
    }
    if (normalizedBase.includes('没有拿到模型回复') && normalizedDetail.includes('没有拿到模型回复')) {
        return true;
    }
    if ((normalizedBase.includes('没有收到模型回复')
            || normalizedBase.includes('没有拿到模型回复')
            || normalizedBase.includes('现在没能生成有效回复')
            || normalizedBase.includes('当前对话服务还不能稳定回答')
            || normalizedBase.includes('暂时没有拿到可靠回复')
            || normalizedBase.includes('暂时没有拿到稳定回复'))
        && /(当前还缺少关键信息|当前条件还不够完整|本轮不会改动画面|处理没有完成)/.test(normalizedDetail)) {
        return true;
    }
    return normalizedBase === normalizedDetail
        || normalizedBase.includes(normalizedDetail)
        || normalizedDetail.includes(normalizedBase);
}

function looksLikeUserFacingFailureDetail(value: string): boolean {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text) return false;
    return /(我先不动你的画面|本轮不会改动画面|这轮不会改动 Photoshop|先不改动画面|需要先|请先|暂时没拿到可靠回复|暂时没有拿到可靠回复|暂时没有拿到稳定回复|现在没能生成有效回复|没有拿到模型回复|当前对话服务还不能稳定回答|没有导出成功|没有可分析的图片资源|当前项目缺少可用|未找到当前项目|没有找到可用|缺少可用|没有可用图片|没有找到文件名|请先补齐|PSD\/PSB|SKU\s*素材文件|SKU\s*素材.{0,32}颜色(?:图层)?组|配置文件需要\s*\d+\s*个颜色槽|模板目录缺少|缺少\s*\d+\s*双模板|缺少[^，。；\n]{0,24}模板)/u.test(text);
}

export function formatAssistantFailureContent(input: {
    message?: string;
    error?: string;
    summaryText?: string;
    successfulMutationCalls?: number;
    prefix?: string;
    businessVisualObservationFeedback?: BusinessSkillVisualObservationFeedback;
}): string {
    let base = cleanAssistantFailureMessageText(input.message);
    const successfulMutationCalls = Number(input.successfulMutationCalls || 0);
    if (successfulMutationCalls > 0 && /(?:本轮|本次|这轮).{0,10}(?:没有|不会|未).{0,10}(?:改动|修改|改).{0,6}(?:画面|文档|Photoshop)/u.test(base)) {
        base = `当前版本已产生 ${successfulMutationCalls} 次画面或文件改动，但后续处理没有完成；请先复核现有结果。`;
    }
    const summaryText = String(input.summaryText || '').trim();
    if (summaryText) {
        base = base
            .replace(`\n\n${summaryText}`, '')
            .replace(summaryText, '')
            .trim() || base;
    }

    const businessFeedbackContent = buildBusinessVisualFeedbackFailureContent(input.businessVisualObservationFeedback);
    if (businessFeedbackContent && isGenericIncompleteAssistantMessage(base)) {
        return `${input.prefix ?? ''}${businessFeedbackContent}`;
    }

    const detail = cleanAssistantFailureErrorText(input.error);
    const visibleDetail = detail && !isRedundantFailureDetail(base, detail) ? detail : '';
    return `${input.prefix ?? '⚠️ '}${base}${visibleDetail ? `\n\n${visibleDetail}` : ''}`;
}

function isGenericIncompleteAssistantMessage(value: string): boolean {
    const compactMessage = String(value || '').trim().replace(/\s+/g, '');
    return !compactMessage
        || compactMessage.includes('当前条件还不完整')
        || compactMessage.includes('当前条件不足')
        || /执行条件.{0,4}满足/.test(compactMessage)
        || compactMessage.includes('本轮不改动文档')
        || /本[次轮].{0,4}没有.{0,4}执行.{0,4}工具/.test(compactMessage);
}

export function formatAssistantBusinessVisualFeedbackContent(input: {
    message?: string;
    businessVisualObservationFeedback?: BusinessSkillVisualObservationFeedback;
}): string {
    const businessFeedbackContent = buildBusinessVisualFeedbackFailureContent(input.businessVisualObservationFeedback);
    if (!businessFeedbackContent) return '';

    const visibleMessage = cleanAssistantFailureMessageText(input.message || '');
    return isGenericIncompleteAssistantMessage(visibleMessage) ? businessFeedbackContent : '';
}

function buildBusinessVisualFeedbackFailureContent(
    feedback?: BusinessSkillVisualObservationFeedback
): string {
    if (!feedback) return '';
    const recommendedActions = Array.isArray(feedback.recommendedActions)
        ? feedback.recommendedActions
        : [];
    const missingInputs = Array.isArray(feedback.missingInputs) ? feedback.missingInputs : [];
    const hasContextRecommendation = recommendedActions.includes('refresh_project_context')
        || recommendedActions.includes('ask_user_to_select_images');
    const hasObservationRecommendation = recommendedActions.includes('offer_visual_analysis');
    const canExplainCurrentGap = hasObservationRecommendation
        || (hasContextRecommendation && (feedback.userVisible || missingInputs.length > 0));
    if (!canExplainCurrentGap) return '';

    const title = sanitizeUserVisibleDiagnosticText(feedback.title);
    const summary = sanitizeUserVisibleDiagnosticText(feedback.summary);
    const actionHint = sanitizeUserVisibleDiagnosticText(feedback.actionHint);
    return [title, summary, actionHint].filter(Boolean).join('\n');
}

export function cleanAssistantResponseContent(content: string): string {
    if (!content) return content;

    const trimmed = String(content).trim();
    const jsonMatch = trimmed.match(/^\s*```json\s*([\s\S]*?)\s*```\s*$/i);
    if (jsonMatch) {
        const unwrapped = unwrapStructuredResponse(jsonMatch[1]);
        if (unwrapped !== null) return removeToolCallMarkup(unwrapped);
    }

    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        const unwrapped = unwrapStructuredResponse(trimmed);
        if (unwrapped !== null) return removeToolCallMarkup(unwrapped);
    }

    return removeToolCallMarkup(content);
}
