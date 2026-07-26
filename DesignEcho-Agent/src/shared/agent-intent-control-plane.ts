import { findSkillRoutingIntent } from './skill-routing';
import { isControlledRouteAutonomousEntrySkill } from './skills/skill-declarations';
import {
    isProjectContextMainImageDeliveryIntent,
    isProjectIdentityConversationIntent
} from './project-image-analysis-intent';
import {
    isSkuExecutionRequestText,
    isSkuTemplateDesignRequestText
} from './sku-intent-params';
import { buildSkuWorkflowStagePlan } from './sku-workflow-stages';
import { isMainImageWhiteBackgroundFromSkuMaterialRequest } from './main-image-white-background-export-contract';
import { shouldRoutePreferenceFeedbackConversationally } from './agent-preference-feedback';

export type AgentIntentControlPlaneVersion = 'agent-intent-control-plane/v0';

export type AgentIntentRequestKind =
    | 'chat_only'
    | 'plan_only'
    | 'clarify'
    | 'uxp_user_tool_only'
    | 'read_only_inspect'
    | 'execute_skill'
    | 'autonomous_execution';

export type AgentIntentToolScope =
    | 'none'
    | 'knowledge_search'
    | 'read_only'
    | 'write_photoshop';

export type AgentIntentExecutionAuthorization =
    | 'none'
    | 'candidate_only'
    | 'confirmed_tool_required';

export interface BuildAgentIntentControlPlaneInput {
    userInput: unknown;
    hasImageInput?: boolean;
    hasDocument?: boolean;
    photoshopConnected?: boolean;
}

export interface AgentIntentControlPlaneDecision {
    version: AgentIntentControlPlaneVersion;
    requestKind: AgentIntentRequestKind;
    toolScope: AgentIntentToolScope;
    shouldUseConversationalPath: boolean;
    allowsDeterministicRoute: boolean;
    allowsRouterModel: boolean;
    allowsAutonomousExecution: boolean;
    requiresClarificationBeforeTools: boolean;
    executionAuthorization: AgentIntentExecutionAuthorization;
    reason: string;
    userVisibleSummary: string;
    matchedSignals: string[];
}

const CASUAL_SUFFIX_PATTERN = '[\\s!！?？,，.。~～]*$';
/**
 * 显式多智能体协作意图（团队流水线/多角色评审）——单一来源，控制面与 engine 共用。
 * 历史上 engine.ts 有一份逐字节相同的 EXPLICIT_TEAM_PIPELINE_INTENT_PATTERN，已收敛到这里
 *（行为冻结由 scripts/smoke-intent-predicate-freeze.cjs 钉桩）。
 * 正则对大小写（/i）不敏感、空白用 \s* 匹配，调用方传原始输入或 normalize 后文本结果一致。
 */
const EXPLICIT_TEAM_PIPELINE_PATTERN = /(设计团队|团队流水线|多智能体|多角色|让团队|团队协作|team\s*pipeline|design\s*team)/i;

/** 用户是否显式点名多智能体协作（设计团队流水线/多角色评审）。engine 的显式指令保护与控制面授权共用本判定。 */
export function hasExplicitTeamPipelineIntent(userInput: unknown): boolean {
    return EXPLICIT_TEAM_PIPELINE_PATTERN.test(String(userInput || ''));
}
/** 用户在 brief 里附带了外部参考链接（URL） */
const REFERENCE_LINK_PATTERN = /https?:\/\/\S+/i;
/** 明确的「基于参考做设计/复刻」执行意图（不含纯只读的「看看/分析」） */
const DESIGN_OR_REPLICATION_INTENT_PATTERN =
    /(复刻|复现|还原|仿照|照着|临摹|套版|做成.{0,4}模板|做一?[张个版幅].{0,4}(主图|详情页|海报|页面|图)|(做|设计|生成).{0,5}(主图|详情页|海报|banner|横幅|模板|页面|落地页))/i;
// GREETING / THANKS / FOLLOW_UP 三条与 agent-orchestration/routing.ts 曾各存一份逐字节等价定义，
// 已收敛为本文件单一来源（导出供 routing 复用；行为冻结由 scripts/smoke-intent-predicate-freeze.cjs 钉桩）。
// 注意：ACK 两份定义存在真实语义分歧（本文件把「明白」当确认；routing 把「开始」当确认），
// 各有调用方依赖差异，未合并——见冻结 smoke 中的分歧钉桩，取舍留待用户决策。
export const GREETING_PATTERN = new RegExp(`^(你好|您好|hello|hi|hey|在吗|在不在)(啊|呀|哈|呢|哦|喔|啦|哟|阿)*${CASUAL_SUFFIX_PATTERN}`, 'i');
export const THANKS_PATTERN = new RegExp(`^(谢谢|感谢|thanks|thank you|thx)(啊|呀|哈|呢|哦|喔|啦)*${CASUAL_SUFFIX_PATTERN}`, 'i');
const ACK_PATTERN = new RegExp(`^(好的|好|ok|收到|明白|可以)(啊|呀|哈|呢|哦|喔|啦)*${CASUAL_SUFFIX_PATTERN}`, 'i');
export const FOLLOW_UP_QUESTION_PATTERN = /^(我)?\s*(还有|有|再问|想问).{0,8}(问题|个问题)[\s!！?？,，.。~～]*$/i;

const CHAT_QUESTION_PATTERNS = [
    /你是(谁|什么模型|做什么的)/i,
    /你(都)?(可以|能)(帮我|为我)?做什么|你(都)?会做什么|支持什么|有哪些能力/i,
    /为什么|怎么理解|是什么|有哪些|聊聊|如何看/i,
    /SKU\s*是什么|sku\s*是什么/i
];

/**
 * Photoshop 工具域实例指向：输入在询问「当前打开的文档/图层/项目素材」这一具体实例，
 * 而不是讨论领域概念。对话默认分支（chat_question / unrouted_question / default_chat）
 * 不得吃掉这类输入——正则词表永远穷举不完具体说法，疑义方向必须翻转为
 * 「交给带工具表的模型」，模型在循环里自己分辨「直接回答」还是「读取文档后回答」。
 * 区分关键：实例信号（当前/这个/打开的 + 域名词，项目清单问法，或只有实例才有的问法如「有几屏」）
 * 指向真实上下文；概念信号（为什么/什么是/一般/应该如何）指向知识问答，保持对话路径。
 */
const TOOL_DOMAIN_INSTANCE_PATTERN = /(当前|这个|这份|打开的|我的|文档里|画布上?|画面上?)\s*的?\s*(文档|图层|画布|画面|详情页|主图|长图|白底图|设计稿|模板|素材|项目|图片|psd|psb)|项目(?:内|里|中)?(?:都)?(?:有什么|有哪些|包含什么|包括什么)|文档(结构|里|中)|图层(结构|列表)|有几屏|每屏|第几屏|分了几屏|(看看|看一下|查看|帮我看|检查一下?)[^。！!？?]{0,12}(文档|图层|画面|画布|详情页|模板|素材|psd|psb)|项目状态|设计方向|设计方案|团队产出|设计状态/i;
const TOOL_DOMAIN_CONCEPT_NEGATIVE_PATTERN = /为什么|怎么理解|什么是|是什么意思|一般来说|通常|应该(怎么|如何)|如何(设计|做|规划|布局)|怎么(设计|做|规划|布局)/i;

function isToolDomainContextInput(input: string): boolean {
    return TOOL_DOMAIN_INSTANCE_PATTERN.test(input)
        && !TOOL_DOMAIN_CONCEPT_NEGATIVE_PATTERN.test(input);
}

const BUSINESS_SKILL_CAPABILITY_TARGET_PATTERN = '(?:sku|主图|详情页|长图|自选备注|备注图|组合图|白底图|点击图|转化图)';
const SKILL_CAPABILITY_QUESTION_PATTERNS = [
    new RegExp(`(?:我问你|我想问|问一下|请问).{0,12}(?:你|agent|智能体|模型)?\\s*(?:会不会|会|能不能|能否|可不可以|可以不可以|可以|能|支持|支不支持|支持不支持)\\s*(?:帮我|给我|为我)?\\s*(?:做|生成|制作|设计|出|处理)?\\s*${BUSINESS_SKILL_CAPABILITY_TARGET_PATTERN}(?:.{0,8}(?:吗|嘛|么|\\?|？))?`, 'i'),
    new RegExp(`(?:你|agent|智能体|模型)?\\s*(?:会不会|能不能|能否|可不可以|可以不可以|支不支持|支持不支持)\\s*(?:帮我|给我|为我)?\\s*(?:做|生成|制作|设计|出|处理)?\\s*${BUSINESS_SKILL_CAPABILITY_TARGET_PATTERN}(?:.{0,8}(?:吗|嘛|么|\\?|？))?`, 'i'),
    new RegExp(`(?:你|agent|智能体|模型)?\\s*(?:会|可以|能|支持)\\s*(?:帮我|给我|为我)?\\s*(?:做|生成|制作|设计|出|处理)?\\s*${BUSINESS_SKILL_CAPABILITY_TARGET_PATTERN}.{0,8}(?:吗|嘛|么|\\?|？)`, 'i'),
    new RegExp(`${BUSINESS_SKILL_CAPABILITY_TARGET_PATTERN}.{0,8}(?:你|agent|智能体|模型)?\\s*(?:会不会|会|能不能|能否|可不可以|可以不可以|可以|能|支持|支不支持|支持不支持)\\s*(?:做|生成|制作|设计|出|处理)?(?:.{0,8}(?:吗|嘛|么|\\?|？))?`, 'i')
];

const PLAN_ONLY_PATTERNS = [
    /(是否|能不能|能否|可不可以|可以不可以|可以).{0,18}(开始|推进|做|进入|执行)/i,
    /(开始|推进|做|进入|执行).{0,18}(是否|能不能|能否|可不可以|可以吗)/i,
    /(还差|还缺|还剩|剩余|距离|离).{0,24}(什么|哪些|多少|问题|完成)/i,
    /(什么|哪些|多少|问题).{0,24}(还差|还缺|还剩|剩余)/i,
    /(最佳实践|怎么处理|怎么做|怎么推进|怎么规划|怎么安排|如何处理|如何推进|如何规划|是否应该)/i,
    /(怎么用|如何使用|怎么通过|如何通过).{0,24}(csv|excel|xlsx|表格|配置|模板|文件|工具|skill|技能)/i,
    /(要不要|要不需要|需不需要|是否|能否|能不能|可不可以|可以不可以).{0,24}(找参考|找设计参考|搜索参考|检索参考|看参考|参考)/i,
    /(主图|详情页|sku|SKU|自选备注|备注图|设计|版式|排版).{0,24}(怎么做|怎么设计|如何做|如何设计|怎么安排|怎么规划|怎么更好|比较好)/i,
    /(系统|架构|方案|规划|计划|路线|阶段|进度).{0,24}(准备|考虑|怎么|如何|哪些|什么|是否|能否)/i,
    /(当前|这个|项目|agent|意图|主图|详情页|sku).{0,24}(完成了吗|算完成|完成了没|还剩|剩余|进度|百分之几|多少没有完成|还需要做哪些|还需要做什么|下一步|下一项)/i
];

const CONVERSATION_ONLY_DIRECTIVE_PATTERNS = [
    /(只|仅|先只|先帮我|先给我).{0,12}(说明|解释|回答|分析|理解|描述|总结|复盘|聊聊|说说)/i,
    /(先).{0,8}(说明|解释|回答|理解|描述|总结).{0,20}(不要|别|先别|不需要|无需|禁止).{0,16}(执行|调用|使用|跑|操作|改动|修改|写入|生成|导出|处理)/i
];
const NEGATED_CONVERSATION_ONLY_DIRECTIVE_PATTERN =
    /(不要|别|禁止|不要只是|别只是|不能只|不只是|不是只).{0,10}(只|仅|先只)?\s*(说明|解释|回答|分析|理解|描述|总结|复盘|聊聊|说说|计划)/i;
const COMPLETION_SCOPED_REPORTING_PATTERN = /(?:完成后|做完后|生成后|导出后|保存后|读回后|验收后)[^。！？!?；;\n]{0,64}(?:只|仅)[^。！？!?；;\n]{0,12}(?:说明|回答|汇报|告诉|描述|总结)/i;

const NO_TOOL_DIRECTIVE_PATTERNS = [
    /(不要|别|先别|不需要|无需|禁止)[^，,。！？!?；;\n]{0,16}(执行|调用|使用|跑)[^，,。！？!?；;\n]{0,8}(任何)?(工具|skill|技能|photoshop|ps)/i,
    /(不要|别|先别|不需要|无需|禁止)[^，,。！？!?；;\n]{0,16}(调用工具|使用工具|执行工具|跑工具|操作\s*(photoshop|ps))/i,
    /(不执行|不调用|不用|先不执行|先不调用)[^，,。！？!?；;\n]{0,8}(任何)?(工具|skill|技能|photoshop|ps)/i
];
const TOOL_CALL_TEXT_NEGATION_PATTERN =
    /(不要|别|禁止)[^。！？!?；;\n]{0,32}(把|将)?[^。！？!?；;\n]{0,24}(工具调用|tool_calls?|执行工具|调用工具|工具名|参数)[^。！？!?；;\n]{0,32}(写成|当成|输出成|伪装成|放进|写在|用)[^。！？!?；;\n]{0,24}(文本|文字|Markdown|代码块|说明)|不要[^。！？!?；;\n]{0,24}(用|以)[^。！？!?；;\n]{0,12}(文本|文字|Markdown|代码块|说明)[^。！？!?；;\n]{0,24}(代替|冒充)[^。！？!?；;\n]{0,12}(工具调用|tool_calls?)/i;
const SCOPED_ACTION_ONLY_DIRECTIVE_PATTERN =
    /(只|仅|当前小步骤只|这个小步骤只|本步骤只)[^，,。！？!?；;\n]{0,20}(建立|创建|新建|生成|添加|读取|关闭|导出|移动|重命名|复制|删除|处理|改动|修改)/i;

const PLAN_ONLY_DIRECTIVE_PATTERNS = [
    /(本轮|这次|当前|先|先只|只|仅)[^，,。！？!?；;\n]{0,24}(给出|输出|说明|整理|制定|提供)?[^，,。！？!?；;\n]{0,12}(设计)?(计划|方案|规划|思路|方向)/i,
    /(计划|方案|规划|思路|方向)[^，,。！？!?；;\n]{0,24}(先|本轮|这次|当前|只|仅)/i
];
const NEGATED_PLAN_ONLY_DIRECTIVE_PATTERN =
    /(不要|别|不需要|无需|不用|不是|不能只|不要只|别只)[^，,。！？!?；;\n]{0,18}(公开)?(设计)?(计划|方案|规划|思路|方向|解释|说明)/i;

const EXPLICIT_AUTONOMOUS_TOOL_EXECUTION_PATTERN =
    /(?:直接|现在|马上|立即|继续|开始|请|要求)[^。！？!?；;\n]{0,32}(?:进入)?(?:自主执行|实际执行|真实执行|执行并调用|调用|使用|运行)[^。！？!?；;\n]{0,20}(?:工具|skill|技能|photoshop|ps)/i;
const EXPLICIT_AUTONOMOUS_TOOL_EXECUTION_INQUIRY_PATTERN =
    /(?:能不能|能否|是否|可不可以|可以不可以|可以吗|行不行|要不要|需不需要|怎么|如何|为什么|是什么)[^。！？!?；;\n]{0,32}(?:自主执行|实际执行|真实执行|执行并调用|调用|使用|运行)[^。！？!?；;\n]{0,20}(?:工具|skill|技能|photoshop|ps)/i;

const FULL_THREE_DELIVERABLE_EXECUTION_PATTERN =
    /^(?=.*(?:完整|全部|全套|整套|全盘|跑完|自主跑完|三个\s*skill|三个\s*技能))(?=.*主图)(?=.*详情页)(?=.*sku)[\s\S]*$/i;

const NO_WRITE_DIRECTIVE_PATTERNS = [
    /(不要|别|先别|不需要|无需|禁止)[^，,。！？!?；;\n]{0,24}(写入|改动|修改|操作|执行|调用|使用|跑)[^，,。！？!?；;\n]{0,16}(photoshop|ps|工具|skill|技能|画面|画布|文档)?/i,
    /(不要|别|先别|不需要|无需|禁止)[^，,。！？!?；;\n]{0,16}(创建|新建|生成|保存|导出)[^，,。！？!?；;\n]{0,16}(photoshop|ps|画面|画布|文档)/i
];

// “只读取/查看/分析，不要修改”是明确的只读授权。这里单独识别用户给出的执行边界，
// 避免通用委托句法把否定短语里的“修改”误当成写入目标。
const EXPLICIT_READ_ONLY_SCOPE_PATTERN =
    /(?:^|[，,。！？!?；;\n])\s*(?:本轮|这次|当前)?\s*(?:只|仅|先只)\s*(?:进行|做)?\s*(?:读取|查看|检查|分析|理解|识别|统计)/i;

const READ_ONLY_INSPECT_PATTERNS = [
    /(看看|看一下|检查|检查一下|验收|复核|分析|识别|理解).{0,20}(当前文档|这个文档|文档结构|详情页结构|模板结构|项目中的图片|项目图片|图片|图层|颜色图层|隐藏图层)/i,
    /(当前文档|这个文档|文档结构|详情页结构|模板结构|图层|颜色图层|隐藏图层|项目图片|项目中的图片).{0,20}(看看|检查|验收|复核|分析|识别|理解|有没有问题|是否正常|能不能用|可不可用|哪里不对|什么类型|是什么|有几个|多少个|几种|多少种)/i,
    /(?:文案文本|文案|文字|文本|标题|副标题).{0,32}(?:在哪|哪里|哪个位置|那个位置|哪一层|哪个图层|那个图层|所在图层)|(?:在哪|哪里|哪个位置|那个位置|哪一层|哪个图层|那个图层|所在图层).{0,32}(?:文案文本|文案|文字|文本|标题|副标题)/i,
    /(看看|看一下|查看|检查|检查一下|统计).{0,20}(模板|模板文件|模板文档).{0,20}(有几个|几个|多少个|几种|多少种|数量|有哪些|列表)?/i,
    /(模板|模板文件|模板文档).{0,20}(有几个|几个|多少个|几种|多少种|数量|有哪些|列表).{0,20}(看看|看一下|查看|检查|检查一下|统计)?/i,
    /(看看|看一下|检查|检查一下|验收|复核|分析|识别|理解).{0,20}(当前|这个)?.{0,8}(项目|project).{0,20}(是什么|什么项目|项目类型|概况|概览|情况|信息|素材|图片|款式|品类|类目|风格|卖点|特征)?/i,
    /(当前|这个)?.{0,8}(项目|project).{0,20}(是什么|什么项目|项目类型|概况|概览|情况|信息|素材|图片|款式|品类|类目|风格|卖点|特征)/i,
    /(当前|这个).{0,8}(是什么|什么).{0,8}(项目|project)/i,
    /(几个|几种|多少个|多少种).{0,10}(图层|颜色|颜色图层)/i,
    /(隐藏|看不到).{0,12}图层|图层.{0,12}(隐藏|看不到)/i,
    /检查.{0,12}(结构|状态|问题|画面|版式)/i
];

const SKU_DOMAIN_PATTERN = /(?:sku|SKU|自选备注|备注图|组合图|颜色组合|规格组合)/i;
const SKU_PLACEHOLDER_ADJUSTMENT_OBJECT_PATTERN = /(?:SKU|sku).{0,24}(?:色卡|卡片|模板|排版|版式)?.{0,24}(?:占位符|占位|placeholder)|(?:占位符|占位|placeholder).{0,24}(?:SKU|sku).{0,24}(?:色卡|卡片|模板|排版|版式)?/i;
const SKU_PLACEHOLDER_ADJUSTMENT_ACTION_PATTERN = /(?:调整|调一下|修改|改一下|改动|移动|挪动|对齐|缩放|放大|缩小|优化|整理|处理|重新排|排版|布局|位置|尺寸|大小|间距)/i;
const SKU_PLACEHOLDER_ADJUSTMENT_AUTHORIZATION_PATTERN = /(?:帮我|请|麻烦你|我想(?:让|请)?你|需要|要|开始|直接|现在|马上|调整|修改|移动|挪动|对齐|优化|整理|处理|改一下|做一下)/i;

const SKU_READ_ONLY_INSPECT_PATTERNS = [
    /(看看|看一下|查看|检查|检查一下|识别|分析|理解|统计).{0,20}(sku|SKU|自选备注|备注图|组合图).{0,24}(配置|素材|文件|文档|颜色|颜色组合|规格|规格组合|组合|数量|有哪些|有什么|目录|结构)?/i,
    /(sku|SKU|自选备注|备注图|组合图).{0,24}(配置|素材|文件|文档|颜色|颜色组合|规格|规格组合|组合|数量|有哪些|有什么|目录|结构).{0,20}(看看|看一下|查看|检查|检查一下|识别|分析|理解|统计)?/i
];

const SKU_DOMAIN_DISCUSSION_PATTERNS = [
    /(想了解|了解一下|了解|想问|问一下|请问|说明|解释|聊聊|说说).{0,24}(sku|SKU|自选备注|备注图|组合图)/i,
    /(sku|SKU|自选备注|备注图|组合图).{0,24}(想了解|了解一下|了解|想问|问一下|请问|说明|解释|聊聊|说说|是什么意思|是什么|怎么理解)/i,
    /(sku|SKU|自选备注|备注图|组合图).{0,18}呢[\s!！?？,，.。~～]*$/i,
    /^(那|那么|还有|对应的)?\s*(自选备注|备注图|组合图).{0,12}呢[\s!！?？,，.。~～]*$/i
];
const BARE_SKU_DOMAIN_PATTERN = /^(?:sku|SKU|自选备注|备注图|组合图|颜色组合|规格组合)[\s!！?？,，.。~～]*$/i;

// 明确的「从零创作新成品」意图短语：从零/从头设计、设计/做一张主图详情页海报。
// 这些只在创作意图里出现，不会出现在「分析项目素材/风格」这类真只读请求里。两处复用：
// (1) 作为只读检查负向词，防止「从零设计主图，用项目模特图」被 inspect 的「项目…图/卖点」
//     联想误判成 read_only（实测：完整 brief 漏判 → 落进 visual-analysis → 无文档读快照必失败）；
// (2) 作为独立前置判定（isExplicitCreativeDesignRequest），盖过 EXPLICIT_SKILL_EXECUTION 的
//     「主图…文档」规格联想，让从零创作走自主设计循环而非硬编码模板 skill。
const EXPLICIT_CREATIVE_DESIGN_PATTERNS = [
    /(从零|从0|从头|凭空).{0,16}(设计|做|画|创作|搭|创建|建立|生成|制作).{0,24}(主图|详情页|长图|海报|banner|横幅|场景图|宣传图|首图|封面|落地页)/i,
    /(设计|做|画|创作|制作)\s*(一张|一个|一版|一幅|个|张)?\s*(主图|详情页|海报|banner|横幅|场景图|宣传图|首图|封面|落地页)/i,
    /(完成|交付|产出).{0,48}(主图|详情页|长图|海报|banner|横幅|场景图|宣传图|首图|封面|落地页)/i,
    /可验收.{0,36}(主图|详情页|长图|海报|banner|横幅|场景图|宣传图|首图|封面|落地页)/i,
    /(主图|详情页|长图|海报|banner|横幅|场景图|宣传图|首图|封面|落地页).{0,24}(可验收|完成|交付|产出)/i,
    /(新建|创建|做|制作|生成|搭建|建立).{0,24}(主图|详情页|海报|banner|横幅|场景图|宣传图|首图|封面|落地页).{0,18}(草稿|画布|版面|视觉|设计稿)/i,
    /(主图|详情页|海报|banner|横幅|场景图|宣传图|首图|封面|落地页).{0,18}(草稿|画布|版面|视觉|设计稿)/i
];

// 规格生产强信号（白底图/点击图/转化图等产品名 + 明确「套/用/基于模板」）：即便句子含
// 「设计主图」字样，命中也应走对应规格 skill（main-image-design 白底/点击图、template-fill 模板填充），
// 而非自主创作循环。注意：只匹配肯定的模板用法（套/用/基于+模板），不裸匹配「模板/线框/骨架」——
// 避免创作 brief 里「真实设计，不要套线框」这类否定指令被误判出创作意图（实测：完整 brief
// 因「不要套线框」的「线框」被误伤，从 autonomous 退回 execute_skill）。
const CREATIVE_DESIGN_NON_TEMPLATE_SPEC_NEGATIVE_PATTERN = /(白底图|白底|自底图|自底|点击图|转化图|模板填充|套版)/i;
const CREATIVE_DESIGN_TEMPLATE_SPEC_PATTERN = /(套|用|基于|按)\s*.{0,6}模板/i;
const NEGATED_TEMPLATE_SPEC_PATTERN = /(不要|别|无需|不用|禁止|避免|不能|不)\s*(直接)?\s*(套|用|基于|按).{0,8}模板/i;

// 准备度/疑问语境（是否可以开始、能不能做、还剩/还差什么）：句子虽含「做主图/做详情页」片段，
// 但语气是问「现在能不能开始」而非「现在去做」。命中这些词时不判创作执行，让它落进 plan_only/对话
// （实测：「看看我们是否可以开始做主图详情页了」被误判成创作执行而非阶段准备度提问）。
const CREATIVE_DESIGN_INQUIRY_NEGATIVE_PATTERN = /(是否|能否|能不能|可不可以|可以不可以|行不行|要不要|需不需要|是不是|有没有|还剩|还差|还缺|缺哪些|准备好|可以开始|能开始|开始了吗|做了吗)/i;

const READ_ONLY_NEGATIVE_PATTERNS = [
    /(保存|另存|导出|关闭|新建|创建|制作|生成|加入|添加|放入|拖入|导入|删除|重命名|改名|置顶|置底|上移|下移|移到|移动到|挪到|排序|调整|修改|替换|换成|改成)/i,
    ...EXPLICIT_CREATIVE_DESIGN_PATTERNS
];

const EXPLICIT_SKILL_EXECUTION_PATTERNS = [
    /(关闭|保存|另存|导出|新建|创建).{0,20}(文档|psd|png|jpg|jpeg|模板)/i,
    /(主图|详情页).{0,24}(模板|文档|制作|创建|新建|生成|导出|保存)/i,
    /(制作|创建|新建|生成|导出|保存).{0,24}(主图|详情页|模板|文档)/i,
    /(加|添加|加入|新增|创建|放入).{0,16}(字体|文字|文本|文案|备注)/i,
    /(字体|文字|文本|文案|备注).{0,16}(加|添加|加入|新增|创建|放入)/i,
    /(字体|文字|文本|文案).{0,16}(改成|改为|替换|换成|设置为|修改为)/i,
    /(改成|改为|替换|换成|设置为|修改为).{0,16}(字体|文字|文本|文案)/i,
    /(图层).{0,20}(顺序|层级|排序|置顶|置底|上移|下移|重命名|改名|删除|复制|拷贝|编组|解除编组|选中|选择)/i,
    /(图层).{0,24}(移到|移动到|挪到|放到).{0,24}(上方|下方|上面|下面)/i,
    /(?:把|将).{1,60}(?:移入|移动到|移到|放到|放入|挪到).{1,24}(?:图层组|分组|组|图层|层)(?:里|内|里面|中)?/i,
    /(?:图层|层).{0,24}(?:移入|移动到|移到|放到|放入|挪到).{1,24}(?:图层组|分组|组)(?:里|内|里面|中)?/i,
    /(选中|选择|重命名|改名|删除|复制|拷贝|编组|解除编组|置顶|置底|上移|下移).{0,18}(当前|选中|目标)?.{0,10}(图层|组|层)/i,
    /从浅到深|从深到浅/i,
    /(参考图|照着|复刻|复现|还原|仿照|同款版式|copy layout|same layout|replicate|recreate)/i,
    /(调试|排查|诊断|定位问题|复现|联调).{0,24}(agent|面板|桥接|mcp|详情页|主图|工具)/i
];

// 修改类动词（重写/换成/替换…）与创建类动词同为明确执行授权：「详情页文案重写一下」
// 「主图换一张」是指令不是讨论——此前缺席导致修改句落 candidate_only 回 execute_skill
// 候选，可能被派进整页套版固定流水线（真机病例：改文案走了详情页设计路线）。
const SKILL_ROUTING_AUTHORIZATION_ACTION_PATTERN = /(帮我|请|麻烦你|开始|执行|做|制作|生成|导出|保存|创建|新建|处理|分析|查看|检查|识别|理解|设计|优化|调整|整理|修改|重写|撰写|重新写|改成|改为|改一下|改下|换成|换一张|换一下|换个|替换|更换|更新|搜索|搜一下|查找|检索|找一些|找一下|帮我找|帮我搜|search|find)/i;
const SKILL_ROUTING_DISCUSSION_PATTERN = /(要不要|要不需要|需不需要|是否|能否|能不能|可不可以|可以不可以|怎么|如何|为什么|是什么|有哪些|聊聊|说明|解释|总结|复盘)/i;
// “怎么设计 / 哪个参考更好”可以是执行任务里的推理要求，不能仅凭疑问词把整条请求降级为只规划。
// 这里只识别用户把任务明确委托给 Agent 的句法，不绑定主图、详情页、SKU 等任何业务品类。
const EXPLICIT_TASK_DELEGATION_PATTERN = /(?:帮我|麻烦你|请你|我想(?:让|请)?你|我想你|需要你|我要你|希望你|要求你|交给你)[^。！？!?；;\n]{0,64}(?:继续\s*)?(?:完成|交付|产出|执行|创建|制作|生成|修改|调整|重做|替换|落地)/i;
const REFERENCE_SEARCH_AUTHORIZATION_PATTERN = /(搜索|搜一下|查找|检索|找一些|找一下|帮我找|帮我搜|search|find)/i;

const UXP_USER_TOOL_ONLY_PATTERNS = [
    /(抠图|去背|去背景|remove background|matte)/i
];

const RETRY_EXECUTION_PATTERN = /(再改一下|重新改|没改成功|没有改成功|没有改|没生效|重试|再做一下)/i;

const OPEN_AUTONOMOUS_EXECUTION_PATTERNS = [
    /(根据|基于|按).{0,16}(当前画面|这个画面|画面|当前文档|参考|素材).{0,24}(设计|整理|优化|调整|重做|做一版|出一版|更高级|更好看|提升)/i,
    /(把|将).{0,16}(当前画面|这个画面|画面|当前文档).{0,24}(整理|优化|调整|设计|重做).{0,24}(高级|好看|视觉重点|质感|商业|电商)/i,
    /(把|将).{0,16}(当前)?(主图|详情页|页面|设计稿).{0,24}(整理|优化|调整|设计|重做).{0,24}(高级|好看|视觉重点|质感|商业|电商)/i,
    /(做|出).{0,8}(一版|一个).{0,24}(更高级|更好看|商业感|电商感|设计|视觉)/i
];

const RESOURCE_CONTEXT_AUTONOMOUS_EXECUTION_PATTERNS = [
    /(打开|读取|使用|用|根据|基于|按).{0,24}(csv|excel|xlsx|表格|配置|模板|文件).{0,48}(批量)?(替换|换成|换图|置换|更新|导入|处理).{0,28}(图标|icon|素材|图片|占位图|智能对象)/i,
    /(批量)?(替换|换成|换图|置换|更新|导入|处理).{0,28}(图标|icon|素材|图片|占位图|智能对象).{0,48}(csv|excel|xlsx|表格|配置|模板|文件)/i,
    /(打开|读取|使用|用|根据|基于|按).{0,24}(csv|excel|xlsx|表格|配置|模板|文件).{0,48}(图标|icon|素材|图片|占位图|智能对象).{0,28}(批量)?(替换|换成|换图|置换|更新|导入|处理)/i
];

const BASIC_PHOTOSHOP_WRITE_OBJECT_PATTERN =
    /(photoshop|ps|文档|画布|页面|图层组|图层|矩形|形状|文字图层|文本图层|文字|文本|文案|标题|副标题|排版|版式|字体|字号|字距|行距|间距|颜色|背景|图片|图标|icon|投影|描边|图层效果|group|layer|rectangle|shape|text layer|copy|headline|subtitle|layout|typography|image|background|drop shadow|shadow|stroke|layer effect|layer style)/i;
const BASIC_PHOTOSHOP_NON_DOCUMENT_WRITE_OBJECT_PATTERN =
    /(页面|图层组|图层|矩形|形状|文字图层|文本图层|文字|文本|文案|标题|副标题|排版|版式|字体|字号|字距|行距|间距|颜色|背景|图片|图标|icon|投影|描边|图层效果|group|layer|rectangle|shape|text layer|copy|headline|subtitle|layout|typography|image|background|drop shadow|shadow|stroke|layer effect|layer style)/i;
const BASIC_PHOTOSHOP_WRITE_ACTION_PATTERN =
    /(真实执行|实际执行|执行|创建|新建|建立|添加|新增|放入|写入|生成|修改|调整|优化|编辑|重写|撰写|重新写|改成|改为|改一下|改下|改|替换|换成|更换|更新|应用|采用|移动|重命名|改名|排序|对齐|缩放|删除|复制|清除|移除|去除|create|draw|add|insert|write|generate|edit|modify|adjust|optimize|rewrite|replace|apply|update|move|rename|align|scale|delete|copy|clear|remove|export)/i;
const BASIC_PHOTOSHOP_WRITE_INQUIRY_NEGATIVE_PATTERN =
    /(能不能|能否|是否|可不可以|可以不可以|可以吗|行不行|怎么|如何|为什么|是什么).{0,24}(执行|创建|新建|建立|添加|新增|放入|写入|生成|修改|调整|优化|编辑|重写|撰写|重新写|改成|改为|改一下|改下|改|替换|换成|更换|更新|应用|采用|移动|重命名|改名|排序|对齐|缩放|删除|复制|清除|移除|去除|create|draw|add|insert|write|generate|edit|modify|adjust|optimize|rewrite|replace|apply|update|move|rename|align|scale|delete|copy|clear|remove|export)|(?:执行|创建|新建|建立|添加|新增|放入|写入|生成|修改|调整|优化|编辑|重写|撰写|重新写|改成|改为|改一下|改下|改|替换|换成|更换|更新|应用|采用|移动|重命名|改名|排序|对齐|缩放|删除|复制|清除|移除|去除|create|draw|add|insert|write|generate|edit|modify|adjust|optimize|rewrite|replace|apply|update|move|rename|align|scale|delete|copy|clear|remove|export).{0,24}(能不能|能否|是否|可不可以|可以不可以|可以吗|行不行|怎么|如何|为什么|是什么)/i;
const COPY_DELIVERABLE_OBJECT_PATTERN =
    /(?:文案|标题|副标题|slogan|标语|广告语|卖点表达|产品描述)/i;
const COPY_AUTHORING_REQUEST_PATTERNS = [
    /(?:撰写|改写|重写|润色|拟定|想出|提供|给出|给我|写出|帮我写|生成).{0,48}(?:文案|标题|副标题|slogan|标语|广告语|卖点表达|产品描述)/i,
    /(?:文案|标题|副标题|slogan|标语|广告语|卖点表达|产品描述).{0,48}(?:撰写|改写|重写|润色|拟定|想出|提供|给出|写出|生成|候选|版本)/i,
    /(?:把|将)?\s*(?:这段|这句|下面|以下|原文|现有)?\s*(?:文案|标题|副标题|slogan|标语|广告语|产品描述).{0,36}(?:改成|改为|换一种表达|突出|强调)/i,
    /(?:优化|调整).{0,20}(?:这段|这句|下面|以下|原文|现有)?\s*(?:文案|措辞|表达|产品描述)/i
];
const COPY_FORMATTING_MUTATION_PATTERN =
    /(?:字体|字号|字重|字距|行距|间距|颜色|排版|版式|位置|坐标|对齐|移动|缩放|投影|描边|图层效果)/i;
const PHOTOSHOP_COPY_TARGET_PATTERN =
    /(?:photoshop|ps|当前(?:画面|页面|文档|图层|图层组|选区|文字|文本|文案|标题)|这个(?:画面|页面|文档|图层|图层组)|第[一二三四五六七八九十\d]+屏|图层组|图层路径|文字图层|文本图层|选中(?:的)?(?:文字|文本|图层)|活动图层|当前选区)/i;
const COPY_POSITIONAL_TARGET_PATTERN =
    /(?:(?:详情页|主图|海报|画面).{0,16})?(?:顶部|底部|首屏|尾屏|左上角|右上角|左下角|右下角|中央|中间|第[一二三四五六七八九十\d]+屏).{0,16}(?:标题|副标题|文案|文字|文本)/i;

const CONTEXTUAL_DESIGN_IMPROVEMENT_PATTERNS = [
    /(这里|这个|当前|画面|版式|视觉|排版|设计|图层).{0,18}(不太好看|不好看|不够好看|不够高级|不够舒服|不协调|太乱|没质感|视觉不够|需要优化|需要调整)/i,
    /(不太好看|不好看|不够好看|不够高级|不够舒服|不协调|太乱|没质感|视觉不够).{0,20}(帮我|请|麻烦你)?.{0,10}(改|优化|调整|整理|设计)/i,
    /(帮我|请|麻烦你).{0,12}(把|将)?(这里|这个|当前|画面|版式|视觉|排版|设计).{0,20}(改好看|改一下|优化|调整|整理|设计|高级|更好看)/i
];

const AMBIGUOUS_ACTION_PATTERNS = [
    /^(帮我|请|麻烦你)?\s*(处理|弄|搞|优化|调整|改|做|整理)(一下|下)?[\s!！?？,，.。~～]*$/i,
    /^(帮我|请|麻烦你)?\s*(处理|弄|搞|优化|调整|改|做|整理)(一下|下)?.{0,12}(这个|这里|图层|画面|它)[\s!！?？,，.。~～]*$/i,
    /(改好看一点|弄好看一点|处理一下这个图层|把这里改好看一点)/i
];

const CONTROL_PLANE_SKILL_ROUTING_EXCLUDES = [
    'matte-product',
    'autonomous-agent'
];

const KNOWLEDGE_SEARCH_SKILL_IDS = new Set([
    'design-reference-search'
]);

function normalizeText(value: unknown): string {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function includesAny(input: string, patterns: RegExp[]): boolean {
    return patterns.some((pattern) => pattern.test(input));
}

function isReadOnlyInspectRequest(input: string): boolean {
    return includesAny(input, READ_ONLY_INSPECT_PATTERNS) && !includesAny(input, READ_ONLY_NEGATIVE_PATTERNS);
}

// 显式从零创作设计成品（从零设计主图/设计一张详情页），排除白底图/模板等规格生产。
// 命中即授权进入自主设计执行循环；真正写入仍由当前可执行动作、上下文和动手前判断控制。
function isExplicitCreativeDesignRequest(input: string): boolean {
    if (isProjectContextMainImageDeliveryIntent(input)) return false;
    const hasSpecNegative = CREATIVE_DESIGN_NON_TEMPLATE_SPEC_NEGATIVE_PATTERN.test(input)
        || (CREATIVE_DESIGN_TEMPLATE_SPEC_PATTERN.test(input) && !NEGATED_TEMPLATE_SPEC_PATTERN.test(input));
    return includesAny(input, EXPLICIT_CREATIVE_DESIGN_PATTERNS)
        && !hasSpecNegative
        && !CREATIVE_DESIGN_INQUIRY_NEGATIVE_PATTERN.test(input);
}

function isSkuReadOnlyInspectRequest(input: string): boolean {
    return includesAny(input, SKU_READ_ONLY_INSPECT_PATTERNS)
        && !includesAny(input, READ_ONLY_NEGATIVE_PATTERNS);
}

function isSkuDomainDiscussionRequest(input: string): boolean {
    return SKU_DOMAIN_PATTERN.test(input)
        && !isSkuExecutionRequestText(input)
        && includesAny(input, SKU_DOMAIN_DISCUSSION_PATTERNS);
}

function isBareSkuDomainRequest(input: string): boolean {
    return BARE_SKU_DOMAIN_PATTERN.test(input)
        && !isSkuExecutionRequestText(input);
}

function hasExplicitConversationOnlyDirective(input: string): boolean {
    const asksForConversationOnly = includesAny(input, CONVERSATION_ONLY_DIRECTIVE_PATTERNS);
    const forbidsToolExecution = includesAny(input, NO_TOOL_DIRECTIVE_PATTERNS)
        && !TOOL_CALL_TEXT_NEGATION_PATTERN.test(input);
    if (forbidsToolExecution) return true;
    // 「只说说/只聊聊/只解释」——「只/仅」紧邻言说动词是明确的对话限定，优先于
    // SCOPED_ACTION_ONLY 判定：后者的动作词表会被句尾「…怎么改」的「改」穿透，
    // 把「先别动手，只说说文案怎么改」误判成动作限定句（真机病例 2026-07-07）。
    // 负向紧邻（「不要只说说，直接改」）不算对话限定；「完成后只说明」是完成后
    // 汇报限定，也不算全程对话限定。
    const directConversationOnly =
        /(只|仅|先只)\s*(说说|聊聊|说明|解释|分析|回答|描述|总结|复盘)/i.test(input)
        && !/(不要|别|禁止|不能|不是)\s*(只|仅)\s*(说说|聊聊|说明|解释|分析|回答|描述|总结|复盘)/i.test(input);
    if (directConversationOnly) {
        return !COMPLETION_SCOPED_REPORTING_PATTERN.test(input);
    }
    if (SCOPED_ACTION_ONLY_DIRECTIVE_PATTERN.test(input)) return false;
    if (NEGATED_CONVERSATION_ONLY_DIRECTIVE_PATTERN.test(input)) return false;
    if (!asksForConversationOnly) return false;
    return !COMPLETION_SCOPED_REPORTING_PATTERN.test(input)
        && /(只|仅|先只|不要|别|不需要|无需|禁止)/i.test(input);
}

function hasExplicitPlanOnlyNoWriteDirective(input: string): boolean {
    if (COMPLETION_SCOPED_REPORTING_PATTERN.test(input)) return false;
    const clauses = input
        .split(/[。！？!?；;\n]+/)
        .map((item) => item.trim())
        .filter(Boolean);
    return clauses.some((clause) => (
        !NEGATED_PLAN_ONLY_DIRECTIVE_PATTERN.test(clause)
        && includesAny(clause, PLAN_ONLY_DIRECTIVE_PATTERNS)
        && includesAny(clause, NO_WRITE_DIRECTIVE_PATTERNS)
    ));
}

function hasExplicitReadOnlyNoWriteDirective(input: string): boolean {
    return EXPLICIT_READ_ONLY_SCOPE_PATTERN.test(input)
        && includesAny(input, NO_WRITE_DIRECTIVE_PATTERNS);
}

function hasExplicitAutonomousToolExecutionDirective(input: string): boolean {
    if (hasExplicitConversationOnlyDirective(input)) return false;
    if (hasExplicitPlanOnlyNoWriteDirective(input)) return false;
    if (!EXPLICIT_AUTONOMOUS_TOOL_EXECUTION_PATTERN.test(input)) return false;
    return !EXPLICIT_AUTONOMOUS_TOOL_EXECUTION_INQUIRY_PATTERN.test(input);
}

function hasExplicitTaskDelegation(input: string): boolean {
    if (hasExplicitConversationOnlyDirective(input)) return false;
    if (hasExplicitPlanOnlyNoWriteDirective(input)) return false;
    if (hasExplicitReadOnlyNoWriteDirective(input)) return false;
    return EXPLICIT_TASK_DELEGATION_PATTERN.test(input);
}

function findControlledSkillRoutingIntent(input: string) {
    return findSkillRoutingIntent(input, {
        excludeSkillIds: CONTROL_PLANE_SKILL_ROUTING_EXCLUDES,
        includeVisibilities: ['user-facing', 'internal-debug']
    });
}

function isFullThreeDeliverableExecutionRequest(input: string): boolean {
    return FULL_THREE_DELIVERABLE_EXECUTION_PATTERN.test(input);
}

function hasConfirmedSkillRoutingAuthorization(input: string, skillId: string): boolean {
    if (hasExplicitConversationOnlyDirective(input)) {
        return false;
    }
    if (
        skillId === 'main-image-design'
        && (
            isProjectContextMainImageDeliveryIntent(input)
            || isConfirmedMainImageWhiteBackgroundFromSkuMaterialExecution(input)
        )
    ) {
        return true;
    }
    const explicitTaskDelegation = hasExplicitTaskDelegation(input);
    if (includesAny(input, PLAN_ONLY_PATTERNS) && !explicitTaskDelegation) {
        return false;
    }
    if (skillId === 'design-reference-search') {
        return REFERENCE_SEARCH_AUTHORIZATION_PATTERN.test(input)
            && !/(要不要|要不需要|需不需要|是否|能否|能不能|可不可以|可以不可以)/i.test(input);
    }
    if (skillId === 'sku-batch') {
        return isSkuExecutionRequestText(input);
    }
    if (skillId === 'visual-analysis' || skillId === 'project-image-analysis') {
        return isReadOnlyInspectRequest(input);
    }
    if (includesAny(input, EXPLICIT_SKILL_EXECUTION_PATTERNS)) {
        return true;
    }
    return SKILL_ROUTING_AUTHORIZATION_ACTION_PATTERN.test(input)
        && (!SKILL_ROUTING_DISCUSSION_PATTERN.test(input) || explicitTaskDelegation);
}

function isOpenAutonomousExecutionRequest(input: string): boolean {
    return includesAny(input, OPEN_AUTONOMOUS_EXECUTION_PATTERNS)
        || includesAny(input, CONTEXTUAL_DESIGN_IMPROVEMENT_PATTERNS);
}

function isResourceContextAutonomousExecutionRequest(input: string): boolean {
    return includesAny(input, RESOURCE_CONTEXT_AUTONOMOUS_EXECUTION_PATTERNS);
}

function isConfirmedMainImageWhiteBackgroundFromSkuMaterialExecution(input: string): boolean {
    if (!isMainImageWhiteBackgroundFromSkuMaterialRequest({ userIntent: input })) return false;
    const explicitTaskDelegation = hasExplicitTaskDelegation(input);
    if (includesAny(input, PLAN_ONLY_PATTERNS) && !explicitTaskDelegation) return false;
    if (SKILL_ROUTING_DISCUSSION_PATTERN.test(input) && !explicitTaskDelegation) return false;
    return includesAny(input, EXPLICIT_SKILL_EXECUTION_PATTERNS)
        || SKILL_ROUTING_AUTHORIZATION_ACTION_PATTERN.test(input);
}

export function isBasicPhotoshopWriteTask(input: string): boolean {
    const text = normalizeText(input);
    if (!text) return false;
    if (hasExplicitConversationOnlyDirective(text.toLowerCase())) return false;
    if (hasExplicitPlanOnlyNoWriteDirective(text.toLowerCase())) return false;
    // 文案本身可以是最终交付物。“撰写 / 改成 / 突出”只说明内容目标，不能在没有
    // 文档、画面、屏或图层目标时被升级成 Photoshop 写入授权。
    if (isStandaloneCopyDeliverableRequest(text)) return false;
    if (BASIC_PHOTOSHOP_WRITE_INQUIRY_NEGATIVE_PATTERN.test(text)
        && !/(请|帮我|麻烦|直接|现在|马上|真实执行|实际执行|不要只解释|不要只说明)/i.test(text)) {
        return false;
    }
    if (!BASIC_PHOTOSHOP_NON_DOCUMENT_WRITE_OBJECT_PATTERN.test(text)) {
        return false;
    }
    return BASIC_PHOTOSHOP_WRITE_OBJECT_PATTERN.test(text)
        && BASIC_PHOTOSHOP_WRITE_ACTION_PATTERN.test(text);
}

function isStandaloneCopyDeliverableRequest(input: string): boolean {
    const text = normalizeText(input);
    if (!text) return false;
    if (!COPY_DELIVERABLE_OBJECT_PATTERN.test(text)) return false;
    if (COPY_FORMATTING_MUTATION_PATTERN.test(text)) return false;
    return COPY_AUTHORING_REQUEST_PATTERNS.some((pattern) => pattern.test(text))
        && !PHOTOSHOP_COPY_TARGET_PATTERN.test(text)
        && !COPY_POSITIONAL_TARGET_PATTERN.test(text);
}

function isSkuPlaceholderAdjustmentRequest(input: string): boolean {
    const text = normalizeText(input);
    if (!text) return false;
    if (hasExplicitConversationOnlyDirective(text.toLowerCase())) return false;
    return SKU_PLACEHOLDER_ADJUSTMENT_OBJECT_PATTERN.test(text)
        && SKU_PLACEHOLDER_ADJUSTMENT_ACTION_PATTERN.test(text)
        && SKU_PLACEHOLDER_ADJUSTMENT_AUTHORIZATION_PATTERN.test(text);
}

export function isAgentSkillCapabilityQuestion(value: unknown): boolean {
    const text = normalizeText(value);
    if (!text) return false;
    if (isSkuPlaceholderAdjustmentRequest(text)) return false;
    if (isReadOnlyInspectRequest(text.toLowerCase())) return false;
    if (!/[?？吗嘛么]|会不会|能不能|能否|可不可以|可以不可以|支不支持|支持不支持|支持哪些|哪些.*能力|能力.*哪些|我问你|我想问|问一下|请问/.test(text)) {
        return false;
    }
    return includesAny(text, SKILL_CAPABILITY_QUESTION_PATTERNS);
}

function makeDecision(
    requestKind: AgentIntentRequestKind,
    input: {
        reason: string;
        userVisibleSummary: string;
        matchedSignals: string[];
        toolScope?: AgentIntentToolScope;
        executionAuthorization?: AgentIntentExecutionAuthorization;
    }
): AgentIntentControlPlaneDecision {
    const defaultToolScope: AgentIntentToolScope = requestKind === 'read_only_inspect'
        ? 'read_only'
        : requestKind === 'execute_skill' || requestKind === 'autonomous_execution'
            ? 'write_photoshop'
            : 'none';
    const toolScope = input.toolScope || defaultToolScope;
    const executionAuthorization = input.executionAuthorization
        || (requestKind === 'read_only_inspect' || requestKind === 'autonomous_execution'
            ? 'confirmed_tool_required'
            : requestKind === 'execute_skill'
                ? 'candidate_only'
                : 'none');

    return {
        version: 'agent-intent-control-plane/v0',
        requestKind,
        toolScope,
        shouldUseConversationalPath: requestKind === 'chat_only' || requestKind === 'plan_only',
        allowsDeterministicRoute: requestKind === 'read_only_inspect'
            || requestKind === 'execute_skill'
            || requestKind === 'autonomous_execution',
        allowsRouterModel: requestKind === 'read_only_inspect'
            || requestKind === 'execute_skill'
            || requestKind === 'autonomous_execution',
        allowsAutonomousExecution: requestKind === 'autonomous_execution',
        requiresClarificationBeforeTools: requestKind === 'clarify',
        executionAuthorization,
        reason: input.reason,
        userVisibleSummary: input.userVisibleSummary,
        matchedSignals: input.matchedSignals
    };
}

/**
 * v3 拓扑：编排层默认进入自主循环时显式签发的执行决策。
 * 这不是对用户输入的正则猜测，而是架构层面的决定——
 * 安全边界由循环内的执行点约束（读后写契约、技能开关、白名单）保证。
 *
 * 关键：必须保留原始控制面决策的 matchedSignals。否则像 explicit_creative_design
 * （从零创作设计）这类决定「跳过 public-plan 门禁、直接进循环」的信号会在重建时丢失，
 * 导致 statusFor 退回 ready_for_model_planning → 走循环外 public-plan 调用（加尺寸等
 * 长 prompt 时易 Premature close）→「这次没有拿到模型回复」。与
 * buildSelfResolvableAutonomousRuntimeDecision 的信号保留语义保持一致。
 */
export function buildAutonomousExecutionDecisionForEngine(
    reason: string,
    source?: Partial<AgentIntentControlPlaneDecision> | null
): AgentIntentControlPlaneDecision {
    const base = makeDecision('autonomous_execution', {
        reason,
        userVisibleSummary: '这是需要创建或调整画面的任务，先整理目标和检查方式。',
        matchedSignals: ['v3_default_autonomous_topology']
    });
    const sourceSignals = source?.matchedSignals;
    if (!Array.isArray(sourceSignals) || sourceSignals.length === 0) return base;
    return {
        ...base,
        matchedSignals: Array.from(new Set([...sourceSignals, 'v3_default_autonomous_topology']))
    };
}

export function resolveAgentIntentExecutionAuthorization(
    decision?: Partial<AgentIntentControlPlaneDecision> | null
): AgentIntentExecutionAuthorization {
    if (decision?.executionAuthorization) return decision.executionAuthorization;
    if (!decision || decision.toolScope === 'none') return 'none';
    if (decision.toolScope === 'knowledge_search') return 'candidate_only';
    if (decision.requestKind === 'read_only_inspect' || decision.requestKind === 'autonomous_execution') {
        return 'confirmed_tool_required';
    }
    if (decision.requestKind === 'execute_skill') return 'confirmed_tool_required';
    return 'none';
}

export function isConfirmedToolRequiredIntent(
    decision?: Partial<AgentIntentControlPlaneDecision> | null
): boolean {
    return resolveAgentIntentExecutionAuthorization(decision) === 'confirmed_tool_required';
}

export function buildAgentIntentControlPlaneDecision(
    input: BuildAgentIntentControlPlaneInput
): AgentIntentControlPlaneDecision {
    const text = normalizeText(input.userInput);
    const normalized = text.toLowerCase();

    if (!normalized) {
        return makeDecision('clarify', {
            reason: '用户输入为空，无法判断执行目标。',
            userVisibleSummary: '需要先明确要处理的目标。',
            matchedSignals: ['empty_input']
        });
    }

    // 明确的长期偏好记录属于对话 + 受治理 Memory 抽取，不是 Photoshop 任务。
    // 在 Router 前固定为 chat_only，避免作用域词（主图 / SKU 等）误导进业务执行链。
    if (shouldRoutePreferenceFeedbackConversationally(text)) {
        return makeDecision('chat_only', {
            reason: '用户明确要求记录长期设计偏好；本轮只进行自然回复和受治理偏好抽取，不进入 Photoshop 执行链。',
            userVisibleSummary: '这是明确的设计偏好记录请求。',
            matchedSignals: ['explicit_preference_feedback']
        });
    }

    if (hasExplicitPlanOnlyNoWriteDirective(normalized)) {
        return makeDecision('plan_only', {
            reason: '用户把本轮限定为先给设计计划，并明确不要写入、操作或改动 Photoshop。',
            userVisibleSummary: '这是只规划请求，先给出设计计划，不写入 Photoshop。',
            matchedSignals: ['explicit_plan_only_no_write']
        });
    }

    if (hasExplicitReadOnlyNoWriteDirective(normalized)) {
        return makeDecision('read_only_inspect', {
            reason: '用户明确把本轮限定为只读取、查看或分析，并禁止修改；只读边界优先于句中其他动作词。',
            userVisibleSummary: '这是明确的只读检查请求，只读取当前上下文，不修改画面。',
            matchedSignals: ['explicit_read_only_no_write']
        });
    }

    // 明确的自主执行 + 工具调用授权优先于句中附带的“下一步动作/当前状态”等汇报措辞。
    // 这里只决定进入通用 Agent loop，不替模型选择业务 Skill；真实写入仍由执行点权限、
    // 读后写纪律与结果读回约束。疑问句与“不要执行”继续留在对话/计划路径。
    if (hasExplicitAutonomousToolExecutionDirective(normalized)) {
        return makeDecision('autonomous_execution', {
            reason: '用户明确要求立即进入自主执行并调用可用工具；句中的状态汇报或下一步说明只是过程可见性要求，不能把执行授权降级为只回复文字。',
            userVisibleSummary: '这是明确的工具执行请求，需要进入 Agent 循环并以真实工具结果为准。',
            matchedSignals: ['explicit_autonomous_tool_execution'],
            executionAuthorization: 'confirmed_tool_required'
        });
    }

    // 显式点名多智能体协作（设计团队/团队流水线/多智能体）= 明确授权进入团队执行循环。
    // 这里只决定进入自主执行，不直接授权具体 Photoshop 写入；执行点仍受当前可执行动作、上下文和动手前判断约束。
    if (EXPLICIT_TEAM_PIPELINE_PATTERN.test(normalized) && !hasExplicitConversationOnlyDirective(normalized)) {
        return makeDecision('autonomous_execution', {
            reason: '用户显式点名设计团队流水线/多智能体协作，授权进入团队执行循环；真实写入仍需满足当前可执行动作、上下文和动手前判断。',
            userVisibleSummary: '这是设计协作请求，需要先整理设计方向和画面分工，确认后再创建画面。',
            matchedSignals: ['explicit_team_pipeline'],
            executionAuthorization: 'confirmed_tool_required'
        });
    }

    // 用户附带外部参考链接并要求设计/复刻时，必须先读取参考内容，再由自主执行流程规划处理。
    if (REFERENCE_LINK_PATTERN.test(text)
        && DESIGN_OR_REPLICATION_INTENT_PATTERN.test(normalized)
        && !hasExplicitConversationOnlyDirective(normalized)) {
        return makeDecision('autonomous_execution', {
            reason: '用户提供了外部参考链接做设计/复刻，必须先读取并理解参考内容，再据此设计，进入能读链接的自主设计循环。',
            userVisibleSummary: '这是带参考链接的设计请求，需要先读取并理解参考内容，再整理可确认的设计方案。',
            matchedSignals: ['reference_link_design'],
            executionAuthorization: 'confirmed_tool_required'
        });
    }

    // 显式从零创作设计成品，进入自主设计循环；规格生产和模板填充仍由后续规则分流。
    if (isExplicitCreativeDesignRequest(normalized) && !hasExplicitConversationOnlyDirective(normalized)) {
        return makeDecision('autonomous_execution', {
            reason: '用户明确要求从零设计主图/详情页等成品（非白底图/模板等规格生产），授权进入自主设计执行循环；真实写入仍需满足当前可执行动作、上下文和动手前判断。',
            userVisibleSummary: '这是从零创作设计请求，需要先整理设计方向和可确认方案，确认后再创建画面。',
            matchedSignals: ['explicit_creative_design'],
            executionAuthorization: 'confirmed_tool_required'
        });
    }

    if (isSkuPlaceholderAdjustmentRequest(text)) {
        return makeDecision('autonomous_execution', {
            reason: '用户要求调整当前 SKU 色卡或模板中的占位符，这是局部设计执行任务，应进入自主执行流程先观察当前文档再决定处理路径，不能被 sku-batch 生产路由截断。',
            userVisibleSummary: '这是 SKU 占位符调整请求，需要先读取当前文档结构，再安全调整并复核。',
            matchedSignals: ['sku_placeholder_adjustment'],
            executionAuthorization: 'confirmed_tool_required'
        });
    }

    if (isSkuTemplateDesignRequestText(text) && !hasExplicitConversationOnlyDirective(normalized)) {
        const skuWorkflowPlan = buildSkuWorkflowStagePlan({ userInput: text });
        return makeDecision('autonomous_execution', {
            reason: `用户要求创建或设计 SKU 排版模板；模板排版属于设计判断，不能由 sku-batch 的固定占位模板直接接管。${skuWorkflowPlan.reason}`,
            userVisibleSummary: `这是 SKU 模板设计请求：${skuWorkflowPlan.userVisibleSummary}。`,
            matchedSignals: ['sku_template_design_autonomy', ...skuWorkflowPlan.matchedSignals],
            executionAuthorization: 'confirmed_tool_required'
        });
    }

    if (
        !hasExplicitConversationOnlyDirective(normalized)
        && isConfirmedMainImageWhiteBackgroundFromSkuMaterialExecution(text)
    ) {
        // 白底图不再内嵌固定流水线：交给 Agent 自主循环处理。main-image-design 仅作为
        // 循环内可选技能工具的路由提示（matchedSignals），不再由引擎直执受控脚本。
        // sku-batch 漂移在执行点天然被挡（denylist→不可直执，business-workflow 兜进循环）。
        return makeDecision('autonomous_execution', {
            reason: '用户把 SKU 表达为白底图素材来源、交付主图白底图导出；这是设计成品请求，交给 Agent 自主执行循环，由模型先观察素材与文档再用工具逐步处理。main-image-design 作为可选技能工具提示，不再套固定流水线；真实写入仍需满足可执行动作、当前上下文与动手前判断。',
            userVisibleSummary: '这是主图白底图导出任务，交给 Agent 自主处理。',
            matchedSignals: ['shared_skill_routing:main-image-design', 'main_image_white_bg_from_sku_material'],
            executionAuthorization: 'confirmed_tool_required'
        });
    }

    if (
        !hasExplicitConversationOnlyDirective(normalized)
        && (isSkuExecutionRequestText(text) || isFullThreeDeliverableExecutionRequest(normalized))
    ) {
        const skuWorkflowPlan = /sku/i.test(text)
            ? buildSkuWorkflowStagePlan({ userInput: text })
            : null;
        return makeDecision('autonomous_execution', {
            reason: skuWorkflowPlan
                ? `用户给出了明确的业务交付请求，应进入自主执行流程；sku-batch 只能作为流程内的受控工作流桥，不应由引擎直接终止式调用。${skuWorkflowPlan.reason}`
                : '用户给出了明确的业务交付请求，应进入自主执行流程，由模型先观察、规划、再根据实际结果逐步执行。',
            userVisibleSummary: skuWorkflowPlan
                ? `这是明确的业务处理请求：${skuWorkflowPlan.userVisibleSummary}。`
                : '这是明确的业务处理请求，需要先让 Agent 规划并检查必要上下文。',
            matchedSignals: [
                'explicit_business_execution',
                'business_workflow_react_entry',
                ...(skuWorkflowPlan ? skuWorkflowPlan.matchedSignals : [])
            ],
            executionAuthorization: 'confirmed_tool_required'
        });
    }

    // 一条交付委托可以同时包含“先理解、找参考、再判断怎么设计”等推理步骤。
    // 委托目标归主 Agent；其中的检索、分析或业务 Skill 只是循环内步骤，不能反过来截断总目标。
    if (hasExplicitTaskDelegation(normalized)) {
        return makeDecision('autonomous_execution', {
            reason: '用户已把一个需要完成、交付或修改的目标明确委托给 Agent；句中的分析、参考检索和方案判断属于完成该目标的步骤，不应把整条请求降级为只规划或单一子能力。',
            userVisibleSummary: '这是明确委托的任务，需要由 Agent 承接完整目标并继续处理。',
            matchedSignals: ['explicit_task_delegation'],
            executionAuthorization: 'confirmed_tool_required'
        });
    }

    if (GREETING_PATTERN.test(normalized) || THANKS_PATTERN.test(normalized) || ACK_PATTERN.test(normalized)) {
        return makeDecision('chat_only', {
            reason: '输入是寒暄、确认或感谢，不需要工具。',
            userVisibleSummary: '这是普通对话，直接回复。',
            matchedSignals: ['casual_conversation']
        });
    }

    if (FOLLOW_UP_QUESTION_PATTERN.test(normalized)) {
        return makeDecision('chat_only', {
            reason: '用户表示还有问题，这是继续提问的会话意图。',
            userVisibleSummary: '这是继续提问，直接回答。',
            matchedSignals: ['follow_up_question']
        });
    }

    if (isAgentSkillCapabilityQuestion(text)) {
        return makeDecision('chat_only', {
            reason: '用户在询问 Agent 是否具备某个业务 skill 能力，不是在授权执行该 skill。',
            userVisibleSummary: '这是能力询问，先说明能做什么。',
            matchedSignals: ['skill_capability_question']
        });
    }

    if (hasExplicitConversationOnlyDirective(normalized)) {
        return makeDecision('chat_only', {
            reason: '用户明确要求先用自然语言说明、理解或回答，并限制本轮不要执行工具。',
            userVisibleSummary: '这是说明请求，先用自然语言解释。',
            matchedSignals: ['explicit_no_tool_directive']
        });
    }

    if (includesAny(normalized, PLAN_ONLY_PATTERNS)
        && !hasExplicitTaskDelegation(normalized)
        && !isProjectContextMainImageDeliveryIntent(text)) {
        return makeDecision('plan_only', {
            reason: '用户在询问进度、准备度、方案或剩余工作，不是执行指令。',
            userVisibleSummary: '这是规划或状态讨论，先说明判断。',
            matchedSignals: ['plan_or_status_question']
        });
    }

    if (isProjectIdentityConversationIntent(text)) {
        return makeDecision('read_only_inspect', {
            reason: '用户在询问当前项目身份，需要基于当前项目上下文只读回答，不能交给模型按历史猜测。',
            userVisibleSummary: '这是项目上下文只读检查，只读取当前项目信息，不允许写入修改。',
            matchedSignals: ['project_identity_question']
        });
    }

    if (isSkuReadOnlyInspectRequest(normalized)) {
        return makeDecision('read_only_inspect', {
            reason: '用户在查看 SKU 相关项目配置、素材或颜色信息，只允许只读检查。',
            userVisibleSummary: '这是 SKU 相关只读检查，只读取项目信息，不写入 Photoshop。',
            matchedSignals: ['sku_read_only_inspection']
        });
    }

    if (isReadOnlyInspectRequest(normalized)) {
        return makeDecision('read_only_inspect', {
            reason: '用户要求查看、检查、理解或统计上下文，只允许只读检查。',
            userVisibleSummary: '这是只读检查请求，只允许读取上下文，不允许写入修改。',
            matchedSignals: ['read_only_inspection']
        });
    }

    if (includesAny(normalized, CHAT_QUESTION_PATTERNS) && !isToolDomainContextInput(normalized)) {
        return makeDecision('chat_only', {
            reason: '用户在询问知识、能力或模型身份，不需要工具执行。',
            userVisibleSummary: '这是对话咨询，直接回答。',
            matchedSignals: ['chat_question']
        });
    }

    if (includesAny(normalized, CHAT_QUESTION_PATTERNS) && isToolDomainContextInput(normalized)) {
        return makeDecision('read_only_inspect', {
            reason: '问题涉及当前文档、图层或项目素材等工具可读对象，应基于真实上下文回答，不能按通用知识猜测。',
            userVisibleSummary: '这是基于当前上下文的查看请求，先读取真实信息再回答。',
            matchedSignals: ['tool_domain_question']
        });
    }

    if (isSkuDomainDiscussionRequest(normalized)) {
        return makeDecision('chat_only', {
            reason: '用户在讨论 SKU 领域概念或追问上下文，不是在授权生成 SKU 图。',
            userVisibleSummary: '这是 SKU 相关讨论，先由模型用自然语言回答。',
            matchedSignals: ['sku_domain_discussion']
        });
    }

    if (isBareSkuDomainRequest(normalized)) {
        return makeDecision('clarify', {
            reason: '用户只输入了 SKU 领域词，缺少要了解、查看还是生成的目标。',
            userVisibleSummary: '需要先确认你是想了解 SKU、查看项目 SKU，还是开始生成 SKU 图。',
            matchedSignals: ['bare_sku_domain']
        });
    }

    if (includesAny(normalized, UXP_USER_TOOL_ONLY_PATTERNS)) {
        return makeDecision('uxp_user_tool_only', {
            reason: '抠图能力属于 UXP 面板用户工具，不向 Agent 对话端提供执行许可。',
            userVisibleSummary: '抠图属于面板里的手动功能；对话端只说明用法，不代替用户操作。',
            matchedSignals: ['uxp_user_tool_only']
        });
    }

    if (isStandaloneCopyDeliverableRequest(text)) {
        return makeDecision('chat_only', {
            reason: '用户要求产出文案候选，但没有指定当前画面、文档或图层写入目标；本轮直接交付文字内容，不授权 Photoshop 修改。',
            userVisibleSummary: '这是文案内容交付，直接提供候选，不改动画面。',
            matchedSignals: ['standalone_copy_deliverable']
        });
    }

    if (isOpenAutonomousExecutionRequest(normalized)) {
        return makeDecision('autonomous_execution', {
            reason: '用户提出了基于当前画面或视觉状态的开放式设计改进诉求，应交给模型先理解目标并规划工具路径。',
            userVisibleSummary: '这是开放式设计改进请求，需要先理解当前画面并形成设计计划。',
            matchedSignals: ['open_autonomous_execution'],
            executionAuthorization: 'confirmed_tool_required'
        });
    }

    const skillRoutingIntent = findControlledSkillRoutingIntent(normalized);
    if (skillRoutingIntent) {
        if (skillRoutingIntent.skillId === 'sku-batch' && !isSkuExecutionRequestText(text)) {
            return makeDecision('clarify', {
                reason: '输入只命中了 SKU 领域词，但没有明确授权生成 SKU 图或自选备注。',
                userVisibleSummary: '需要先确认你是想了解 SKU、查看项目 SKU，还是开始生成 SKU 图。',
                matchedSignals: ['sku_domain_without_execution_authorization']
            });
        }

        // 去刻意路线：声明为「受控路由命中→交给 Agent 自主循环」的业务工作流技能（如详情页），
        // 一律不走固定流水线 execute_skill，而进自主 ReAct 循环（技能作为循环内可选工具提示）。
        // 安全由执行点约束保证：denylist 阻止模型直执 + 循环内读后写/看图门禁。
        // 弱授权也归一自主循环（2026-07-07 拆牢笼）：此前 candidate_only 回落 execute_skill 候选，
        // 与技能自己的 autonomous-react-loop 声明自相矛盾——路由候选机制仍可能把「改一句文案」
        // 派进整页套版流水线。归一后授权强度保持 candidate_only 不升（能不能动工具仍由执行授权
        // 与执行点契约判定），只是「由谁决策」归一到带完整工具表的主模型，不再替模型选路线。
        // 用户明确限定「只聊不动手」时不归一自主执行：掉到下方原有候选/对话语义，
        // 由对话路径处理（弱授权归一只针对"路线"，不覆盖用户的显式对话边界）。
        if (
            isControlledRouteAutonomousEntrySkill(skillRoutingIntent.skillId)
            && !hasExplicitConversationOnlyDirective(normalized)
        ) {
            const confirmed = hasConfirmedSkillRoutingAuthorization(normalized, skillRoutingIntent.skillId);
            return makeDecision('autonomous_execution', {
                reason: confirmed
                    ? `用户输入命中受控业务技能 ${skillRoutingIntent.skillId} 且含明确执行授权；该技能已声明交给 Agent 自主循环处理（不套固定流水线），技能仅作循环内可选工具。真实写入仍需满足当前可执行动作、上下文与动手前判断。`
                    : `用户输入命中受控业务技能 ${skillRoutingIntent.skillId} 但未见明确执行授权；该技能已声明交给 Agent 自主循环处理，由主模型自行判断是回答、澄清还是执行，不回落固定流水线候选。真实写入仍需满足执行授权与动手前判断。`,
                userVisibleSummary: confirmed
                    ? '这是明确的业务处理请求，交给 Agent 自主处理。'
                    : '这是业务相关请求，交给 Agent 判断怎么处理。',
                matchedSignals: confirmed
                    ? [`shared_skill_routing:${skillRoutingIntent.skillId}`, 'controlled_skill_autonomous_entry']
                    : [`shared_skill_routing:${skillRoutingIntent.skillId}`, 'controlled_skill_autonomous_entry_candidate'],
                executionAuthorization: confirmed ? 'confirmed_tool_required' : 'candidate_only'
            });
        }

        const isKnowledgeSearchSkill = KNOWLEDGE_SEARCH_SKILL_IDS.has(skillRoutingIntent.skillId);
        const executionAuthorization = hasConfirmedSkillRoutingAuthorization(normalized, skillRoutingIntent.skillId)
            ? 'confirmed_tool_required'
            : 'candidate_only';
        return makeDecision('execute_skill', {
            reason: executionAuthorization === 'confirmed_tool_required'
                ? (isKnowledgeSearchSkill
                    ? '用户输入命中了明确的外部参考或知识检索请求，只授权知识检索工具，不提升到 Photoshop 写入。'
                    : '用户输入命中了共享技能路由元数据，并包含明确执行授权，允许进入受控技能路由。')
                : '用户输入命中了业务 skill 候选，但还没有明确授权工具执行；只能作为模型路由候选。',
            userVisibleSummary: isKnowledgeSearchSkill
                ? '这是参考或知识检索请求，可以搜索资料，但不改动画面。'
                : executionAuthorization === 'confirmed_tool_required'
                    ? '这是明确的业务处理请求，可以准备按要求处理。'
                    : '这是业务能力相关讨论，先由模型判断是否需要继续。',
            matchedSignals: [`shared_skill_routing:${skillRoutingIntent.skillId}`],
            toolScope: isKnowledgeSearchSkill ? 'knowledge_search' : undefined,
            executionAuthorization
        });
    }

    if (isBasicPhotoshopWriteTask(text)) {
        return makeDecision('autonomous_execution', {
            reason: '用户明确要求真实执行基础 Photoshop 写入动作（文档、图层、图层组、文字或形状），不能交给普通对话回复声称完成。',
            userVisibleSummary: '这是基础 Photoshop 写入任务，需要进入 Agent 执行循环并以真实工具结果为准。',
            matchedSignals: ['basic_photoshop_write_task'],
            executionAuthorization: 'confirmed_tool_required'
        });
    }

    if (isResourceContextAutonomousExecutionRequest(normalized)) {
        return makeDecision('autonomous_execution', {
            reason: '用户提出了基于项目文件、表格、模板或素材的具体修改任务，应先检索项目资源和当前文档，再规划工具路径。',
            userVisibleSummary: '这是基于项目资源的可执行任务，需要先查找相关文件和当前文档，再继续处理。',
            matchedSignals: ['resource_context_autonomous_execution'],
            executionAuthorization: 'confirmed_tool_required'
        });
    }

    if (includesAny(normalized, AMBIGUOUS_ACTION_PATTERNS)) {
        return makeDecision('autonomous_execution', {
            reason: '用户表达了开放式处理意图，但目标细节需要由模型结合上下文继续理解和规划。',
            userVisibleSummary: '这是开放式处理请求，需要模型先理解上下文并形成计划。',
            matchedSignals: ['ambiguous_action'],
            executionAuthorization: 'candidate_only'
        });
    }

    if (RETRY_EXECUTION_PATTERN.test(normalized)
        || includesAny(normalized, EXPLICIT_SKILL_EXECUTION_PATTERNS)) {
        return makeDecision('execute_skill', {
            reason: '用户给出了明确业务能力、Photoshop 操作或可路由技能目标。',
            userVisibleSummary: '这是明确的处理请求，可以准备按要求处理。',
            matchedSignals: ['explicit_skill_execution'],
            executionAuthorization: 'confirmed_tool_required'
        });
    }

    if (/[?？]/.test(normalized)) {
        if (isToolDomainContextInput(normalized)) {
            return makeDecision('read_only_inspect', {
                reason: '问题涉及当前文档、图层或项目素材等工具可读对象，应基于真实上下文回答，不能按通用知识猜测。',
                userVisibleSummary: '这是基于当前上下文的查看请求，先读取真实信息再回答。',
                matchedSignals: ['tool_domain_question']
            });
        }
        return makeDecision('chat_only', {
            reason: '输入是问题形态，且没有命中可安全执行的 Photoshop 动作。',
            userVisibleSummary: '这是问题咨询，直接回答。',
            matchedSignals: ['unrouted_question']
        });
    }

    if (/(帮我|请|需要|想让你|麻烦你|做|处理|生成|执行|修改|调整|优化|整理)/i.test(normalized)) {
        return makeDecision('autonomous_execution', {
            reason: '输入看起来像任务请求，但未命中受控业务技能；交给模型先理解目标并决定是否需要工具。',
            userVisibleSummary: '这是需要模型先理解目标的任务请求。',
            matchedSignals: ['unrouted_task_like_input'],
            // 兜底正则只是「像任务」的猜测，不是用户确认的执行授权。若吃 makeDecision 的
            // confirmed 默认值，engine 会据此作废 router 模型的对话判定（candidate_only
            // 弱授权尊重 router 是既定语义）——真机病例：「介绍你现在能帮我做什么设计任务」
            // 因含「请/帮我/做」被判执行，纯对话咨询直接撞 Photoshop 桥 blocker。
            executionAuthorization: 'candidate_only'
        });
    }

    if (isToolDomainContextInput(normalized)) {
        return makeDecision('read_only_inspect', {
            reason: '输入提到当前文档、图层或项目素材等工具可读对象，先读取真实上下文再回应，不按对话猜测。',
            userVisibleSummary: '这是基于当前上下文的查看请求，先读取真实信息再回应。',
            matchedSignals: ['tool_domain_context']
        });
    }

    return makeDecision('chat_only', {
        reason: '未命中执行、只读检查或自主设计许可，默认按对话处理。',
        userVisibleSummary: '这是对话内容，直接回复。',
        matchedSignals: ['default_chat']
    });
}
