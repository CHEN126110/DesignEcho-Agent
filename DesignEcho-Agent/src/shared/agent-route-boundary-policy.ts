import {
    getSkillById,
    isControlledRouteAutonomousEntrySkill
} from './skills/skill-declarations';

export type AgentRouteBoundaryVersion = 'agent-route-boundary-policy/v0';

export interface SimpleDeterministicRouteBoundaryInput {
    skillId?: string;
    hasVisibleModelReasoning: boolean;
    hasContextImage: boolean;
    /** 用户原始输入：长输入/多行正文不允许正则短路径抢跑（真机病例：文案内容被当成指令） */
    userInputText?: string;
}

export interface DeterministicRouteVetoInput {
    deterministicSkillId?: string;
    modelSkillId?: string;
    isRetryRoute?: boolean;
    isSkuIntent?: boolean;
    isMainImageDesignIntent?: boolean;
    isDocumentManagementIntent?: boolean;
    isLayoutReplicationIntent?: boolean;
    isDetailTemplateAuthoringIntent?: boolean;
    isMainImageTemplateAuthoringIntent?: boolean;
    isTemplateSaveIntent?: boolean;
}

export interface DeterministicNonExecutionProtectionInput {
    deterministicSkillId?: string;
    requestKind?: string;
    executionAuthorization?: string;
    modelRoute?: string;
    modelDirectResponse?: string;
    modelClarificationQuestion?: string;
    isRetryRoute?: boolean;
    isSkuIntent?: boolean;
    isMainImageDesignIntent?: boolean;
    isDocumentManagementIntent?: boolean;
    isLayoutReplicationIntent?: boolean;
    isDetailTemplateAuthoringIntent?: boolean;
    isMainImageTemplateAuthoringIntent?: boolean;
    isTemplateSaveIntent?: boolean;
    userRequestedClarification?: boolean;
}

export interface ConversationalRouteBoundaryInput {
    requestKind?: string;
    executionAuthorization?: string;
    allowsAutonomousExecution?: boolean;
    intentRequestsConversationalPath: boolean;
    lightweightIntentIsConversational: boolean;
    publicPlanConfirmed?: boolean;
}

export interface RouteBoundaryDecision {
    version: AgentRouteBoundaryVersion;
    allowed: boolean;
    reason: string;
    category: 'simple_mechanical_operation'
        | 'coordinator_workflow'
        | 'protected_deterministic_route'
        | 'business_or_open_design'
        | 'insufficient_context'
        | 'not_applicable';
}

const SIMPLE_DETERMINISTIC_SHORT_PATH_SKILLS = new Set<string>([
    'document-management',
    'layer-management',
    'text-font-replace'
]);

const COORDINATOR_WORKFLOW_SHORT_PATH_SKILLS = new Set<string>([
    'ecommerce-socks-design'
]);

export function isSimpleDeterministicShortPathSkill(skillId?: string): boolean {
    return Boolean(skillId && SIMPLE_DETERMINISTIC_SHORT_PATH_SKILLS.has(skillId));
}

export function isCoordinatorWorkflowShortPathSkill(skillId?: string): boolean {
    return Boolean(skillId && COORDINATOR_WORKFLOW_SHORT_PATH_SKILLS.has(skillId));
}

/**
 * 对话提示只能在控制面没有签发明确执行授权时决定最终路线。
 * 轻量意图用于改善普通对话体验，不能把“继续执行”“从刚才停止处继续”这类
 * 已授权任务从 autonomous runtime 降级为只回复文字。
 */
export function shouldEnterConversationalRoute(input: ConversationalRouteBoundaryInput): boolean {
    if (input.publicPlanConfirmed === true) return false;
    if (
        input.requestKind === 'autonomous_execution'
        && input.executionAuthorization === 'confirmed_tool_required'
        && input.allowsAutonomousExecution === true
    ) {
        return false;
    }
    return input.intentRequestsConversationalPath || input.lightweightIntentIsConversational;
}

// 业务/开放式设计 skill 从 SkillDeclaration.routeClass 派生（规范可插拔 skill·声明即单一真相源），
// 不再硬编码 skillId Set——business-workflow（主图/详情页/SKU）与 open-design（复刻/项目图分析/自主体）
// 一样不能走简单机械短路径。新增/移除这类 skill 只动声明，本策略零改动。
export function isBusinessOrOpenDesignSkill(skillId?: string): boolean {
    if (!skillId) return false;
    const routeClass = getSkillById(skillId)?.routeClass;
    return routeClass === 'business-workflow' || routeClass === 'open-design';
}

export function isMetadataOnlyProjectInventoryRoute(
    skillId?: string,
    params?: Record<string, unknown> | null
): boolean {
    if (skillId !== 'project-image-analysis') return false;
    if (!params || typeof params !== 'object') return false;
    return params.analysisMode === 'inventory'
        && Number(params.sampleSize ?? 0) === 0;
}

export function evaluateSimpleDeterministicRouteBoundary(
    input: SimpleDeterministicRouteBoundaryInput
): RouteBoundaryDecision {
    if (!input.skillId) {
        return makeBoundaryDecision(false, 'not_applicable', '没有确定性路由候选。');
    }

    if (isCoordinatorWorkflowShortPathSkill(input.skillId)) {
        return makeBoundaryDecision(true, 'coordinator_workflow', '父级协调 workflow 不直接替代子技能做设计判断，可以先启动并把设计决策交给子 Agent。');
    }

    if (input.hasContextImage) {
        return makeBoundaryDecision(false, 'business_or_open_design', '带图请求需要保留模型路由或自主规划。');
    }

    // 长输入/多行正文不允许正则短路径抢跑（真机病例 2026-07-07：用户给出待修改的四行文案，
    // 文案内容「从浅到深都很耐看」命中裸正则被当成图层明度排序指令直接执行）。
    // 输入越长，正则误击率越高、模型理解的价值越大——短路径只配吃"置顶这个图层"级的短指令。
    const userInputText = String(input.userInputText || '');
    if (userInputText && (userInputText.trim().length > 40 || /\r|\n/.test(userInputText.trim()))) {
        return makeBoundaryDecision(false, 'business_or_open_design', '输入较长或包含多行正文（可能含文案等自然语言内容），正则意图判定不可靠，交给模型理解后再执行。');
    }

    if (isBusinessOrOpenDesignSkill(input.skillId)) {
        return makeBoundaryDecision(false, 'business_or_open_design', '业务或开放式设计 skill 不能走简单短路径。');
    }

    if (!isSimpleDeterministicShortPathSkill(input.skillId)) {
        return makeBoundaryDecision(false, 'not_applicable', '该 skill 不是可短路径的机械 Photoshop 操作。');
    }

    return makeBoundaryDecision(true, 'simple_mechanical_operation', '命中安全机械 Photoshop 操作；写入安全由执行预检继续约束。');
}

export function evaluateDeterministicRouteVeto(
    input: DeterministicRouteVetoInput
): RouteBoundaryDecision {
    if (!input.deterministicSkillId || !input.modelSkillId) {
        return makeBoundaryDecision(false, 'not_applicable', '缺少确定性路由或模型路由结果。');
    }

    if (input.deterministicSkillId === input.modelSkillId) {
        return makeBoundaryDecision(false, 'not_applicable', '模型路由与确定性路由一致，不需要否决。');
    }

    if (input.isRetryRoute) {
        return makeBoundaryDecision(true, 'protected_deterministic_route', '重试反馈必须延续上一条已确认操作。');
    }

    if (
        isControlledRouteAutonomousEntrySkill(input.deterministicSkillId)
        && !isControlledRouteAutonomousEntrySkill(input.modelSkillId)
    ) {
        return makeBoundaryDecision(
            true,
            'protected_deterministic_route',
            '已由能力声明识别出的业务工作流不能被通用单步操作降级；应进入 Agent 循环完成主要目标。'
        );
    }

    if (
        input.deterministicSkillId === 'sku-batch'
        && input.isSkuIntent
    ) {
        return makeBoundaryDecision(true, 'protected_deterministic_route', '明确 SKU 执行请求不能被主图、详情页、父级全套工作流或开放式设计 skill 抢路由。');
    }

    if (input.deterministicSkillId === 'main-image-design' && input.isMainImageDesignIntent) {
        return makeBoundaryDecision(true, 'protected_deterministic_route', '明确主图、白底图、点击图或转化图请求不能被 SKU 编排抢路由。');
    }

    if (input.deterministicSkillId === 'document-management' && input.isDocumentManagementIntent) {
        return makeBoundaryDecision(true, 'protected_deterministic_route', '明确文档管理请求不能被业务 skill 抢路由。');
    }

    if (input.deterministicSkillId === 'layout-replication' && input.isLayoutReplicationIntent) {
        return makeBoundaryDecision(true, 'protected_deterministic_route', '带参考图复刻请求不能被其他设计 skill 抢路由。');
    }

    if (input.deterministicSkillId === 'save-current-template' && input.isTemplateSaveIntent) {
        return makeBoundaryDecision(true, 'protected_deterministic_route', '明确模板保存请求不能被其他设计 skill 抢路由。');
    }

    return makeBoundaryDecision(false, 'not_applicable', '确定性路由不构成安全否决，允许模型选择更合适的 skill。');
}

export function evaluateDeterministicNonExecutionProtection(
    input: DeterministicNonExecutionProtectionInput
): RouteBoundaryDecision {
    if (!input.deterministicSkillId) {
        return makeBoundaryDecision(false, 'not_applicable', '缺少确定性路由候选。');
    }

    if (input.isRetryRoute) {
        return makeBoundaryDecision(true, 'protected_deterministic_route', '重试反馈必须延续上一条已确认操作。');
    }

    if (input.requestKind === 'read_only_inspect') {
        return makeBoundaryDecision(true, 'protected_deterministic_route', '明确只读检查请求不能被模型非执行回复截断。');
    }

    if (input.requestKind !== 'execute_skill') {
        return makeBoundaryDecision(false, 'not_applicable', '该请求类型不需要覆盖模型非执行回复。');
    }

    if (
        input.deterministicSkillId === 'sku-batch'
        && input.isSkuIntent
    ) {
        return evaluateBusinessSkillNonExecutionProtection(input, '明确 SKU 执行请求不能被模型泛化回复截断。');
    }

    if (input.deterministicSkillId === 'main-image-design' && input.isMainImageDesignIntent) {
        return evaluateBusinessSkillNonExecutionProtection(input, '明确主图、白底图、点击图或转化图请求不能被模型泛化回复截断。');
    }

    if (input.deterministicSkillId === 'document-management' && input.isDocumentManagementIntent) {
        return makeBoundaryDecision(true, 'protected_deterministic_route', '明确文档管理请求不能被模型非执行回复截断。');
    }

    if (input.deterministicSkillId === 'layout-replication' && input.isLayoutReplicationIntent) {
        return evaluateBusinessSkillNonExecutionProtection(input, '带参考图复刻请求不能被模型泛化回复截断。');
    }

    if (input.deterministicSkillId === 'save-current-template' && input.isTemplateSaveIntent) {
        return makeBoundaryDecision(true, 'protected_deterministic_route', '明确模板保存请求不能被模型非执行回复截断。');
    }

    return makeBoundaryDecision(false, 'not_applicable', '该确定性路由不需要覆盖模型非执行回复。');
}

function evaluateBusinessSkillNonExecutionProtection(
    input: DeterministicNonExecutionProtectionInput,
    protectedReason: string
): RouteBoundaryDecision {
    if (input.modelRoute === 'direct_response') {
        if (input.executionAuthorization === 'confirmed_tool_required' && !input.userRequestedClarification) {
            return makeBoundaryDecision(true, 'protected_deterministic_route', protectedReason);
        }
        if (isUnsafeDirectResponseDrift(input.modelDirectResponse, {
            userRequestedClarification: input.userRequestedClarification
        })) {
            return makeBoundaryDecision(true, 'protected_deterministic_route', protectedReason);
        }
        return makeBoundaryDecision(false, 'not_applicable', '模型给出了非泛化的直接回复，保留模型判断。');
    }

    if (input.modelRoute === 'clarification_needed') {
        const clarification = normalizeText(input.modelClarificationQuestion);
        if (
            !clarification
            || isGenericClarificationDrift(clarification)
            || isBusinessDefaultDecisionClarificationDrift(input.deterministicSkillId, clarification)
            || (!input.userRequestedClarification && isSelfResolvableBusinessClarification(input.deterministicSkillId, clarification))
            || (!input.userRequestedClarification && isExecutionClarificationQuestionDrift(clarification))
        ) {
            return makeBoundaryDecision(true, 'protected_deterministic_route', protectedReason);
        }
        if (hasDomainSpecificClarification(input.deterministicSkillId, clarification)) {
            return makeBoundaryDecision(false, 'not_applicable', '模型提出的是当前业务领域内的有效追问，不能强行进入工具执行。');
        }
        return makeBoundaryDecision(false, 'not_applicable', '模型提出了具体追问，保留模型判断。');
    }

    return makeBoundaryDecision(false, 'not_applicable', '缺少模型非执行路由结果，不能强行覆盖。');
}

function isUnsafeDirectResponseDrift(
    text?: string,
    options: { userRequestedClarification?: boolean } = {}
): boolean {
    const normalized = normalizeText(text);
    if (!normalized) return true;
    if (
        normalized.includes('我可以协助这些设计工作')
        || normalized.includes('你可以直接提出主图、sku、详情页')
        || normalized.includes('我会先判断它属于对话、只读检查还是需要进入处理流程')
    ) {
        return true;
    }
    if (isExplicitUserDecisionDirectResponse(normalized)) {
        return !options.userRequestedClarification;
    }
    return (!options.userRequestedClarification && isExecutionClarificationDirectResponseDrift(normalized))
        || /(?:本轮|这次|当前).{0,16}(?:不|没有|无需).{0,8}(?:调用|执行).{0,12}(?:工具|photoshop)/i.test(normalized)
        || /(?:只是|属于).{0,12}(?:能力询问|对话问题|说明请求).{0,24}(?:不|无需|不会).{0,8}(?:调用|执行)/i.test(normalized);
}

function isExecutionClarificationDirectResponseDrift(normalized: string): boolean {
    return /(?:先确认|确认一下|需要确认|请确认|想确认|先问|先了解).{0,40}(?:品类|类目|规格|颜色|尺码|款式|素材|模板|文件|配置|需求)/i.test(normalized)
        || /(?:这是什么品类|是什么品类|有哪些规格|哪些规格|有哪些颜色|哪些颜色|哪些尺码|哪些款式|现在有哪些规格).{0,40}(?:产品|sku|规格|颜色|尺码|款式|素材|模板|配置)?/i.test(normalized)
        || /(?:请告诉我|告诉我|请提供|需要提供|需要补充).{0,40}(?:品类|类目|规格|颜色|尺码|款式|素材|模板|配置|具体需求)/i.test(normalized)
        || /(?:可以|能|会).{0,16}(?:帮你|为你)?(?:做|处理|生成|制作).{0,24}(?:sku|组合图).{0,40}(?:不过|但是|但).{0,70}(?:品类|类目|规格|颜色|尺码|款式|素材|从头搭)/i.test(normalized)
        || /(?:你这个|这个|当前)?(?:商品|产品).{0,12}(?:是什么|什么).{0,8}(?:品类|类目)/i.test(normalized)
        || /(?:有几(?:款|种)?|几款|几种).{0,16}(?:颜色|规格|尺码|款式)/i.test(normalized)
        || /(?:项目里|当前项目|现在).{0,24}(?:有素材了吗|有没有素材|素材.*有了吗|有.*素材)/i.test(normalized);
}

function isExecutionClarificationQuestionDrift(normalized: string): boolean {
    return /(?:这是什么品类|是什么品类|什么品类|什么类目|是哪类产品)/i.test(normalized)
        || /(?:目前|现在|一共|具体)?(?:有|有哪些|哪些|几种|几款).{0,18}(?:sku\s*)?(?:规格|颜色|尺码|款式)/i.test(normalized)
        || /(?:请告诉我|告诉我|请提供|需要提供|需要补充).{0,40}(?:品类|类目|规格|颜色|尺码|款式|具体需求)/i.test(normalized)
        || /(?:项目里|当前项目|现在).{0,24}(?:有素材了吗|有没有素材|素材.*有了吗|有.*素材)/i.test(normalized)
        || /(?:缺少|没有|未读取到).{0,32}(?:sku\s*)?(?:源文件|素材|规格|模板).{0,40}(?:请|需要|先).{0,12}(?:确认|提供|告诉|补充)/i.test(normalized);
}

function isExplicitUserDecisionDirectResponse(text: string): boolean {
    return /(?:先|暂时|当前|本轮|这次)?.{0,8}(?:不要|不先|先不|暂不).{0,8}(?:执行|调用|写入|处理|生成|导出).{0,24}(?:等|待|直到).{0,12}(?:你|用户).{0,12}(?:确认|决定|补充|提供)/i.test(text)
        || /(?:需要|请).{0,12}(?:你|用户).{0,12}(?:确认|补充|提供).{0,24}(?:后|再).{0,12}(?:执行|生成|导出|处理|写入)/i.test(text);
}

function isGenericClarificationDrift(text: string): boolean {
    return /需要先(?:明确|说明).{0,28}(?:目标|具体动作|交付结果|哪个图层|哪个画面|要处理哪个图层|要处理哪个画面)/.test(text)
        || /(?:要处理|处理的是).{0,8}(?:哪个图层|哪个画面|哪个文档)/.test(text)
        || /想达到什么效果/.test(text)
        || /是否允许修改当前文档/.test(text);
}

function isBusinessDefaultDecisionClarificationDrift(skillId: string | undefined, text: string): boolean {
    if (skillId === 'sku-batch') {
        return /(?:哪些|什么|哪几种|确认|说明).{0,12}(?:颜色组合|颜色|组合)/.test(text);
    }
    if (skillId === 'main-image-design') {
        return /(?:哪个|哪种|哪一款|告诉我|确认).{0,12}(?:sku\s*)?颜色/.test(text);
    }
    return false;
}

function isSelfResolvableBusinessClarification(skillId: string | undefined, text: string): boolean {
    if (skillId === 'sku-batch') {
        return isSkuSourceSelectionClarification(text);
    }
    return false;
}

function isSkuSourceSelectionClarification(text: string): boolean {
    const mentionsCurrentSource = /(?:当前|打开|已打开|正在打开).{0,24}(?:psd|psb|文档|文件|sku|色卡|素材)/i.test(text);
    const mentionsProjectSource = /(?:项目|当前项目).{0,36}(?:sku|psd|psb|色卡|素材|源文件|源文档|来源)/i.test(text)
        || /(?:psd|psb)[\\/]+sku\.(?:psd|psb)|sku\.(?:psd|psb)/i.test(text);
    const asksChoice = /(?:还是|或者|或|哪一个|哪个|哪份|要用|使用|作为|当作|来源)/i.test(text);
    return mentionsCurrentSource && mentionsProjectSource && asksChoice;
}

function hasDomainSpecificClarification(skillId: string | undefined, text: string): boolean {
    if (!skillId) return false;
    const domainPatterns: Record<string, RegExp> = {
        'sku-batch': /(?:sku|自选|备注|组合图|规格|颜色|双装|单双|多双|源文件|素材|模板|psd|psb)/i,
        'main-image-design': /(?:主图|白底图?|点击图|转化图|800|750|1200|1:1|3:4|9:16|导出|sku|颜色)/i,
        'layout-replication': /(?:参考图|复刻|布局|版式|间距|字号|元素|画布)/i
    };
    return Boolean(domainPatterns[skillId]?.test(text));
}

function normalizeText(text?: string): string {
    return String(text ?? '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

function makeBoundaryDecision(
    allowed: boolean,
    category: RouteBoundaryDecision['category'],
    reason: string
): RouteBoundaryDecision {
    return {
        version: 'agent-route-boundary-policy/v0',
        allowed,
        category,
        reason
    };
}
