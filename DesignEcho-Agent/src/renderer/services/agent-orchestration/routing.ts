import { useAppStore } from '../../stores/app.store';
import { applySharedSkillParamDefaults } from '../../../shared/skill-param-defaults';
import {
    extractDocumentManagementRoutingParams,
    findSkillRoutingIntent,
    isAmbiguousSkuSourceExportText,
    matchesSkillRoutingIntent,
    resolveSkillRoutingMode,
    normalizeSkillId as normalizeSharedSkillId
} from '../../../shared/skill-routing';
import {
    extractSkuComboSizesFromText,
    isSkuExecutionRequestText,
    isSkuTemplateDesignRequestText,
    isSkuNoteOnlyText,
    isSkuSourceForNonSkuDocumentTargetText,
    stripSkuDownstreamContextText
} from '../../../shared/sku-intent-params';
import { extractEcommerceSocksDeliverables } from '../../../shared/ecommerce-socks-design';
import { inferReferenceReplicationArtifactKind } from '../../../shared/reference-replication-output-intent';
import {
    getSkillById,
    isControlledRouteAutonomousEntrySkill
} from '../../../shared/skills/skill-declarations';
import {
    buildAgentIntentControlPlaneDecision,
    isAgentSkillCapabilityQuestion,
    isBasicPhotoshopWriteTask,
    GREETING_PATTERN,
    THANKS_PATTERN,
    FOLLOW_UP_QUESTION_PATTERN,
    type AgentIntentControlPlaneDecision
} from '../../../shared/agent-intent-control-plane';
import {
    isProjectIdentityConversationIntent,
    isProjectImageAnalysisInventoryOverviewIntent
} from '../../../shared/project-image-analysis-intent';
import type {
    AgentDecision,
    DeterministicSkillRoute,
    LightweightIntent
} from './types';

type DeterministicIntentMatch = {
    skillId: string;
    mode?: 'inspect' | 'execute';
    params?: Record<string, any>;
};

export interface DeterministicRouteOptions {
    hasAttachedImage?: boolean;
    intentControlPlane?: AgentIntentControlPlaneDecision;
}

const QUESTION_SAFE_DETERMINISTIC_SKILLS = new Set<string>([
    'document-management',
    'layer-management',
    'visual-analysis',
    'text-font-replace',
    'find-and-edit-element',
    'save-current-template',
    'layout-replication'
]);

const CASUAL_SUFFIX_PATTERN = '[\\s!！?？,，.。~～]*$';
// GREETING / THANKS / FOLLOW_UP_QUESTION 三条正则已收敛到 shared/agent-intent-control-plane 单一来源
//（本文件原有的 \uXXXX 转义副本与其逐字节等价，行为冻结见 scripts/smoke-intent-predicate-freeze.cjs）。
// ACK 故意保留本地定义：与 control-plane 的 ACK 存在真实语义分歧
//（本文件把「开始」当确认 → detectLightweightIntent 返回 'ack'；control-plane 把「明白」当 casual_conversation），
// 两处各有调用方依赖，未合并，取舍留待用户决策。
const ACK_PATTERN = new RegExp(`^(\\u597d\\u7684|\\u597d|ok|\\u6536\\u5230|\\u5f00\\u59cb|\\u53ef\\u4ee5)(\\u554a|\\u5440|\\u54c8|\\u5462|\\u54e6|\\u5594|\\u5566)*${CASUAL_SUFFIX_PATTERN}`, 'i');
const CONTINUATION_PATTERN = /^(好的|好|ok|收到|可以)?\s*(继续|接着|继续下一项|继续下一步|继续推进|按照计划继续|继续剩余|接着做|往下做|下一项|下一步)[\s!！?？,，.。~～]*$/i;
const SELF_INTRODUCTION_PATTERN = /(\u4f60\u662f\u8c01|\u4f60\u662f\u505a\u4ec0\u4e48|\u4ecb\u7ecd\u4e00\u4e0b\u4f60|\u4ecb\u7ecd\u4f60\u81ea\u5df1)/;
const CAPABILITY_QUESTION_PATTERN = /(\u4f60(\u90fd)?(\u53ef\u4ee5|\u80fd)(\u5e2e\u6211|\u4e3a\u6211)?\u505a\u4ec0\u4e48|\u4f60(\u90fd)?\u4f1a\u505a\u4ec0\u4e48|\u652f\u6301\u4ec0\u4e48|\u6709\u54ea\u4e9b\u80fd\u529b)/;
const ARCHITECTURE_DISCUSSION_PATTERN = /从.{0,12}(系统|架构|技术).{0,32}(准备|考虑|怎么|如何|哪些|什么)/i;
const GENERAL_CHAT_QUESTION_PATTERN = /(\?|\uff1f|\u4e3a\u4ec0\u4e48|\u600e\u4e48|\u5982\u4f55|\u804a\u804a|\u5728\u505a\u4ec0\u4e48|\u662f\u4ec0\u4e48|\u6709\u54ea\u4e9b|\u54ea\u4e9b|\u80fd\u4e0d\u80fd|\u80fd\u5426|\u53ef\u4ee5\u5417|\u4ece.{0,12}(\u7cfb\u7edf|\u67b6\u6784|\u6280\u672f).{0,24}(\u51c6\u5907|\u8003\u8651|\u600e\u4e48|\u5982\u4f55|\u54ea\u4e9b|\u4ec0\u4e48))/;
const PLAN_OR_DISCUSSION_QUESTION_PATTERN = /(\u662f\u5426|\u80fd\u4e0d\u80fd|\u80fd\u5426|\u53ef\u4e0d\u53ef\u4ee5|\u53ef\u4ee5\u4e0d\u53ef\u4ee5|\u53ef\u4ee5).{0,18}(\u5f00\u59cb|\u63a8\u8fdb|\u505a|\u8fdb\u5165|\u6267\u884c)|(\u5f00\u59cb|\u63a8\u8fdb|\u505a|\u8fdb\u5165|\u6267\u884c).{0,18}(\u662f\u5426|\u80fd\u4e0d\u80fd|\u80fd\u5426|\u53ef\u4e0d\u53ef\u4ee5|\u53ef\u4ee5\u5417)|(\u8fd8\u5dee|\u8fd8\u7f3a|\u8fd8\u5269|\u5269\u4f59|\u8ddd\u79bb).{0,24}(\u4ec0\u4e48|\u54ea\u4e9b|\u591a\u5c11|\u95ee\u9898)|(\u4ec0\u4e48|\u54ea\u4e9b|\u591a\u5c11|\u95ee\u9898).{0,24}(\u8fd8\u5dee|\u8fd8\u7f3a|\u8fd8\u5269|\u5269\u4f59)|(\u6700\u4f73\u5b9e\u8df5|\u600e\u4e48\u5904\u7406|\u600e\u4e48\u770b|\u5982\u4f55\u5904\u7406|\u662f\u4e0d\u662f|\u662f\u5426\u5e94\u8be5)/i;
const COLOR_LAYER_INSPECTION_PATTERN = /((几个|几种|多少个|多少种).{0,8}颜色|颜色图层)/i;
const LAYER_STATE_INSPECTION_PATTERN = /((几个|几种|多少个|多少种).{0,8}图层|隐藏.{0,12}图层|图层.{0,12}隐藏|看不到.{0,12}图层|图层.{0,12}看不到)/i;
const LAYER_VISUAL_ANALYSIS_PATTERN = /(?:图层|层).{0,80}(?:图片|图像|画面|内容|里面|里).{0,40}(?:是什么|有什么|看一下|看看|分析|识别|理解)|(?:看一下|看看|分析|识别|理解).{0,40}(?:图层|层).{0,80}(?:图片|图像|画面|内容|里面|里)/i;
const TEMPLATE_INSPECTION_NEGATIVE_PATTERNS = [
    /(?:保存|另存|导出|关闭|新建|创建|制作|生成|加入|添加|放入|拖入|导入|删除|重命名|改名)/i,
    /(?:设计库|模板库|素材库)/i,
    /(?:sku|主图|抠图|去背|字体|图层顺序|置顶|置底)/i
];

const MATTE_PATTERNS = [/\u62a0\u56fe/i, /\u53bb\u80cc/i, /\u53bb\u80cc\u666f/i, /remove background/i, /matte/i];
const AGENT_MATTING_PAUSED_MESSAGE = '抠图属于 UXP 面板用户工具；对话端不会代替用户执行。需要说明用法时，可以直接说明使用目标。';
const SKU_PATTERNS = [
    /sku/i,
    /\u6279\u91cf\u914d\u8272/i,
    /\u6279\u91cf\u51fa\u56fe/i,
    /\u7ec4\u5408\u56fe/i,
    /\u6279\u91cf\u751f\u6210/i,
    /\u81ea\u9009\u5907\u6ce8/i,
    /\u5907\u6ce8\u56fe/i,
    /\u53cc\u88c5/i,
    /\u5355\u53cc(?:\u88c5)?/i,
    /\u4e00\s*\u53cc(?:\u88c5)?/i
];
const ECOMMERCE_SOCKS_DESIGN_PATTERNS = [
    /电商.{0,8}袜子.{0,8}设计/i,
    /袜子.{0,8}电商.{0,8}设计/i,
    /(整套|全套|一套).{0,12}(袜子|袜).{0,12}(电商|主图|详情页|sku)/i,
    /^(?=.*(?:完整|全部|全套|整套|全盘|跑完|自主跑完|三个\s*skill|三个\s*技能))(?=.*主图)(?=.*详情页)(?=.*sku)[\s\S]*$/i,
    /(主图).{0,8}(详情页).{0,8}(sku)/i,
    /(主图).{0,8}(sku).{0,8}(详情页)/i,
    /(详情页).{0,8}(主图).{0,8}(sku)/i,
    /socks\s+ecommerce\s+design/i
];
const TEMPLATE_SAVE_PATTERNS = [/\u4fdd\u5b58.*\u6a21\u677f/i, /\u53e6\u5b58.*\u6a21\u677f/i, /\u52a0\u5165.*\u8bbe\u8ba1\u5e93/i, /\u5f53\u524d\u6587\u6863.*\u6a21\u677f/i, /save.*template/i, /template.*library/i];
const AGENT_PANEL_PATTERNS = [/agent\u9762\u677f/i, /\u667a\u80fd\u4f53\u9762\u677f/i, /\u6865\u63a5\u8c03\u8bd5/i, /mcp\u8c03\u8bd5/i, /\u8054\u8c03/i, /\u56de\u4f20/i];
const DEBUG_PATTERNS = [/\u8c03\u8bd5/i, /\u6392\u67e5/i, /\u8bca\u65ad/i, /\u5b9a\u4f4d\u95ee\u9898/i, /\u590d\u73b0/i, /\u8054\u8c03/i, /debug/i, /\u6d4b\u8bd5/i, /\u9a8c\u8bc1/i];
const MAIN_IMAGE_PATTERNS = [/\u4e3b\u56fe/i, /main image/i, /conversion/i, /click\u56fe/i, /\u767d\u5e95\u56fe/i, /\u70b9\u51fb\u56fe/i, /\u8f6c\u5316\u56fe/i];
const DESIGN_REFERENCE_SEARCH_PATTERNS = [
    /(搜索|搜一下|查找|检索|找一些|找一下|找).{0,24}(参考|参考图|设计参考|视觉参考|参考案例|灵感)/i,
    /(参考|参考图|设计参考|视觉参考|参考案例|灵感).{0,24}(搜索|搜一下|查找|检索|找一些|找一下|找)/i,
    /(搜索|搜一下|查找|检索|找一些|找一下|找).{0,28}(竞品|竞店|对标|同款|同类|类似|相似风格|类似风格).{0,28}(设计|方案|案例|视觉|参考|款式)?/i,
    /(竞品|竞店|对标|同款|同类|类似|相似风格|类似风格).{0,28}(设计|方案|案例|视觉|参考|款式)?.{0,28}(搜索|搜一下|查找|检索|找一些|找一下|找)/i,
    /(search|find).{0,24}(reference|inspiration|design)/i
];
const DESIGN_REFERENCE_SEARCH_NEGATIVE_PATTERNS = [
    /复刻|复现|还原|照着做|按图做|同款版式|copy layout|replicate|recreate/i,
    /sku.{0,8}(组合图|自选备注|备注图|批量出图)/i
];
const ATTACHED_REFERENCE_REPLICATION_PATTERNS = [
    /复刻/i,
    /复现/i,
    /还原/i,
    /仿照/i,
    /临摹/i,
    /照着/i,
    /按.{0,8}(图|图片|参考|这个|这张|其中|内容)/i,
    /(这个|这张|其中|内容).{0,8}(复刻|复现|还原|仿照|临摹)/i,
    /replicate|recreate|rebuild|copy\s+layout|same\s+layout/i
];
const TEXT_FONT_REPLACE_PATTERNS = [
    /\u628a.*\u5b57\u4f53.*\u6539\u6210/i,
    /\u5b57\u4f53.*\u6539\u6210/i,
    /font.*change/i,
    /replace.*font/i,
    /(\u5168\u90e8|\u6240\u6709).*(\u5b57\u4f53|\u6587\u5b57|\u6587\u672c|\u6587\u6848)/i
];
const LAYER_MANAGEMENT_PATTERNS = [
    /\u56fe\u5c42.{0,12}(\u987a\u5e8f|\u5c42\u7ea7|\u6392\u5e8f|\u7f6e\u9876|\u7f6e\u5e95|\u4e0a\u79fb|\u4e0b\u79fb|\u91cd\u547d\u540d|\u5220\u9664|\u590d\u5236|\u62f7\u8d1d|\u7f16\u7ec4|\u89e3\u9664\u7f16\u7ec4|\u9009\u4e2d|\u9009\u62e9)/i,
    /(\u9009\u4e2d|\u9009\u62e9|\u91cd\u547d\u540d|\u6539\u540d|\u5220\u9664|\u5220\u6389|\u590d\u5236|\u62f7\u8d1d|\u7f16\u7ec4|\u89e3\u9664\u7f16\u7ec4|\u53d6\u6d88\u7f16\u7ec4|\u7f6e\u9876|\u7f6e\u5e95|\u4e0a\u79fb|\u4e0b\u79fb).{0,12}(\u5f53\u524d|\u9009\u4e2d|\u5df2\u9009\u4e2d|\u76ee\u6807)?.{0,8}\u56fe\u5c42/i,
    /(\u9009\u4e2d|\u9009\u62e9|\u91cd\u547d\u540d|\u6539\u540d|\u5220\u9664|\u5220\u6389|\u590d\u5236|\u62f7\u8d1d|\u7f16\u7ec4|\u89e3\u9664\u7f16\u7ec4|\u53d6\u6d88\u7f16\u7ec4|\u7f6e\u9876|\u7f6e\u5e95|\u4e0a\u79fb|\u4e0b\u79fb).{0,12}\u5f53\u524d(?:\u7684)?(?:\u7ec4|\u56fe\u5c42\u7ec4|\u5c42)/i,
    /\u56fe\u5c42.{0,20}(\u79fb\u5230|\u79fb\u52a8\u5230|\u653e\u5230|\u632a\u5230).{0,20}(\u4e0a\u65b9|\u4e0b\u65b9|\u4e0a\u9762|\u4e0b\u9762)/i,
    /(?:把|将).{1,60}(?:移入|移动到|移到|放到|放入|挪到).{1,24}(?:图层组|分组|组|图层|层)(?:里|内|里面|中)?/i,
    /(?:图层|层).{0,24}(?:移入|移动到|移到|放到|放入|挪到).{1,24}(?:图层组|分组|组)(?:里|内|里面|中)?/i,
    /(\u987a\u5e8f|\u5c42\u7ea7|\u6392\u5e8f|\u7f6e\u9876|\u7f6e\u5e95|\u4e0a\u79fb|\u4e0b\u79fb|\u79fb\u5230.*(?:\u4e0a\u65b9|\u4e0b\u65b9|\u9876\u5c42|\u5e95\u5c42)).{0,12}\u56fe\u5c42/i,
    // \u771f\u673a\u75c5\u4f8b\uff082026-07-07\uff09\uff1a\u88f8\u300c\u4ece\u6d45\u5230\u6df1\u300d\u628a\u7528\u6237\u5f85\u4fee\u6539\u6587\u6848\u300c\u4ece\u6d45\u5230\u6df1\u90fd\u5f88\u8010\u770b\u300d\u5f53\u6210
    // \u56fe\u5c42\u660e\u5ea6\u6392\u5e8f\u6307\u4ee4\u76f4\u63a5\u6267\u884c\u3002\u65b9\u5411\u8bcd\u5fc5\u987b\u5e26\u56fe\u5c42/\u6392\u5e8f\u8bed\u5883\u951a\u5b9a\uff0c\u4e0d\u8bb8\u88f8\u5339\u914d\u81ea\u7136\u8bed\u8a00\u6b63\u6587\u3002
    /(?:\u56fe\u5c42|\u5c42|\u989c\u8272).{0,12}\u4ece\u6d45\u5230\u6df1|\u4ece\u6d45\u5230\u6df1.{0,10}(?:\u6392\u5e8f|\u6392\u5217|\u6392\u4e00\u4e0b|\u6392\u4e2a|\u56fe\u5c42)/i,
    /(?:\u56fe\u5c42|\u5c42|\u989c\u8272).{0,12}\u4ece\u6df1\u5230\u6d45|\u4ece\u6df1\u5230\u6d45.{0,10}(?:\u6392\u5e8f|\u6392\u5217|\u6392\u4e00\u4e0b|\u6392\u4e2a|\u56fe\u5c42)/i,
    /(\u51e0\u4e2a|\u51e0\u79cd|\u591a\u5c11\u4e2a|\u591a\u5c11\u79cd).{0,8}\u56fe\u5c42/i,
    // \u300c\u51e0\u79cd\u989c\u8272\u300d\u540c\u7406\uff1a\u5546\u54c1\u6587\u6848\u5e38\u89c1\uff08"\u51e0\u79cd\u989c\u8272\u53ef\u9009"\uff09\uff0c\u5fc5\u987b\u5e26\u56fe\u5c42\u8bed\u5883
    /(\u51e0\u4e2a|\u51e0\u79cd|\u591a\u5c11\u4e2a|\u591a\u5c11\u79cd).{0,8}\u989c\u8272.{0,6}(?:\u56fe\u5c42|\u5c42)/i,
    /(?:文案文本|文案|文字|文本|标题|副标题).{0,32}(?:在哪|哪里|哪个位置|那个位置|哪一层|哪个图层|那个图层|所在图层)/i,
    /(?:在哪|哪里|哪个位置|那个位置|哪一层|哪个图层|那个图层|所在图层).{0,32}(?:文案文本|文案|文字|文本|标题|副标题)/i,
    /\u989c\u8272\u56fe\u5c42/i,
    /\u9690\u85cf.{0,12}\u56fe\u5c42|\u56fe\u5c42.{0,12}\u9690\u85cf|\u770b\u4e0d\u5230.{0,12}\u56fe\u5c42|\u56fe\u5c42.{0,12}\u770b\u4e0d\u5230/i,
    /layer\s+(order|stack|rename|delete|duplicate|group|select)/i
];
const CANVAS_ELEMENT_TARGET_PATTERNS = [
    /(?:左上角|右上角|左下角|右下角|顶部|底部|中间|中心|左侧|右侧|上方|下方).{0,18}(?:文案|文字|文本|标题|副标题|价格|按钮|图片|图标|元素)/i,
    /(?:文案|文字|文本|标题|副标题|价格|按钮|图片|图标|元素).{0,18}(?:左上角|右上角|左下角|右下角|顶部|底部|中间|中心|左侧|右侧|上方|下方)/i,
    /(?:这个|这个画面|当前画面|画布上|页面上|海报上).{0,18}(?:文案|文字|文本|标题|价格|按钮|图片|图标|元素)/i,
    /(?:色卡|卡片|颜色卡|配色).{0,18}(?:顺序编号|编号|序号|号码|数字)/i,
    /(?:顺序编号|编号|序号|号码|数字).{0,18}(?:色卡|卡片|颜色卡|配色)/i
];
const CANVAS_ELEMENT_ACTION_PATTERNS = [
    /(?:改成|改为|替换成|换成|写成|设置为|修改为|改一下|修改一下|替换|选中|选择|定位|移动|挪到|放大|缩小|缩放|透明度|不透明度|混合模式|换图|替换图片|去除|去掉|移除|隐藏|不显示|取消显示|拿掉)/i,
    /(?:set|change|replace|select|locate|move|scale|opacity|blend)/i
];
// 改文案（改已有文本内容，而非生成/设计）：文案/文字类名词 + 明确的改动词。
// 目的：让「改文案 X 改成 Y」稳定进 find-and-edit-element——即便句中带「详情页」也不被 detail-page-design 抢路由
//（find-and-edit-element 判定在 detail-page-design 之前，只要意图能命中即先返回）；
// 「做/写 详情页文案」等生成类不含改动词，不会误伤。
const TEXT_CONTENT_EDIT_NOUN_PATTERN = /(?:文案|文字|文本|标题|副标题)/i;
const TEXT_CONTENT_EDIT_VERB_PATTERN = /(?:改成|改为|替换成|换成|写成|修改为|改一下|修改一下)/i;
function isTextContentEditIntent(normalized: string): boolean {
    return TEXT_CONTENT_EDIT_NOUN_PATTERN.test(normalized) && TEXT_CONTENT_EDIT_VERB_PATTERN.test(normalized);
}
const RETRY_FEEDBACK_PATTERNS = [
    /\u518d\u6539\u4e00\u4e0b/i,
    /\u91cd\u65b0\u6539/i,
    /\u6ca1\u6539\u6210\u529f/i,
    /\u6ca1\u6709\u6539\u6210\u529f/i,
    /\u597d\u50cf\u6ca1\u6709\u6539\u6210\u529f/i,
    /\u8fd8\u662f\u4e0d\u5bf9/i,
    /\u8fd8\u662f\u6ca1\u6539/i,
    /\u6ca1\u751f\u6548/i,
    /\u518d\u505a\u4e00\u4e0b/i,
    /\u91cd\u8bd5/i
];
const MODEL_IDENTITY_PATTERNS = [
    /\u4f60\u662f\u4ec0\u4e48\u6a21\u578b/i,
    /\u4f60\u7528\u7684\u662f\u4ec0\u4e48\u6a21\u578b/i,
    /\u7528\u7684.*\u6a21\u578b/i,
    /\u54ea\u4e2a\u6a21\u578b/i,
    /what model are you/i,
    /which model are you/i,
    /what model do you use/i
];
const MODEL_COMPARISON_PATTERNS = [
    /(gemini|gpt|claude|qwen|deepseek|doubao|glm|kimi).*(\u54ea\u4e2a|\u54ea\u4e2a\u66f4\u5f3a|\u66f4\u5f3a|\u66f4\u597d|\u5bf9\u6bd4|\u533a\u522b)/i,
    /(\u54ea\u4e2a|\u54ea\u4e2a\u66f4\u5f3a|\u66f4\u5f3a|\u66f4\u597d|\u5bf9\u6bd4|\u533a\u522b).*(gemini|gpt|claude|qwen|deepseek|doubao|glm|kimi)/i,
    /(gemini|gpt|claude|qwen|deepseek|doubao|glm|kimi).*(vs|versus|compare)/i,
    /compare.*(gemini|gpt|claude|qwen|deepseek|doubao|glm|kimi)/i
];
const TASK_SUMMARY_PATTERNS = [
    /(回顾|总结|复盘).{0,16}(上次|刚才|之前|我们的任务|任务|进度|工作|聊天|对话)/i,
    /(上次|刚才|之前).{0,16}(任务|工作|修改|做了什么|完成了什么|进度).{0,16}(总结|回顾|复盘|汇报)?/i,
    /(汇报|报告|说一下|告诉我).{0,10}(进度|剩余内容|完成情况|当前状态|还有多少)/i,
    /(项目|任务|开发).{0,10}(进度|剩余内容|完成情况|当前状态|还有多少)/i,
    /(agent|意图|基础设施|项目|任务|开发|规划|主线|当前|我们).{0,16}(完成了吗|算完成|完成了没|还剩|剩余|进度|百分之几|多少事情|多少没有完成|还需要做哪些|还需要做什么|下一步|下一项)/i,
    /(距离|离).{0,16}(还需要|还差|剩余|哪些|什么)/i
];

function containsAny(input: string, patterns: RegExp[]): boolean {
    return patterns.some((pattern) => pattern.test(input));
}

function normalizeInput(input: string): string {
    return String(input || '').trim().toLowerCase();
}

export function isAgentMattingPaused(): boolean {
    return true;
}

export function getAgentMattingPausedMessage(): string {
    return AGENT_MATTING_PAUSED_MESSAGE;
}

function isColorLayerInspectionRequest(input: string): boolean {
    return COLOR_LAYER_INSPECTION_PATTERN.test(input);
}

function isLayerStateInspectionRequest(input: string): boolean {
    return LAYER_STATE_INSPECTION_PATTERN.test(input);
}

function isTemplateInventoryInspectionIntent(input: string): boolean {
    const normalized = normalizeInput(input);
    if (!normalized) return false;
    if (containsAny(normalized, TEMPLATE_INSPECTION_NEGATIVE_PATTERNS)) return false;
    return /(?:模板|模板文件|模板文档).{0,16}(?:有几个|几个|多少个|几种|多少种|数量|有哪些|列表)/i.test(normalized)
        || /(?:看看|看一下|查看|检查|检查一下|统计).{0,16}(?:模板|模板文件|模板文档).{0,16}(?:有几个|几个|多少个|几种|多少种|数量|有哪些|列表)/i.test(normalized);
}

function shouldRouteQuestionToDeterministicSkill(match: DeterministicIntentMatch | null): boolean {
    return Boolean(match?.skillId && QUESTION_SAFE_DETERMINISTIC_SKILLS.has(match.skillId));
}

function isGeneralChatQuestion(input: string): boolean {
    return !isMatteIntent(input) && GENERAL_CHAT_QUESTION_PATTERN.test(input);
}

function isPlanOrDiscussionQuestion(input: string): boolean {
    const normalized = normalizeInput(input);
    if (!normalized) return false;
    if (FOLLOW_UP_QUESTION_PATTERN.test(normalized)) return true;
    if (PLAN_OR_DISCUSSION_QUESTION_PATTERN.test(normalized)) return true;
    return false;
}

function isActionableBusinessRequest(input: string): boolean {
    const normalized = normalizeInput(input);
    if (!normalized) return false;
    if (isAgentSkillCapabilityQuestion(input)) return false;
    if (!/(帮我|请|做|生成|处理|出图|规划|整理|制作|创建|新建|调整|修改|执行|需要|一起|整体)/i.test(normalized)) {
        return false;
    }
    return isSkuIntent(normalized)
        || isEcommerceSocksDesignIntent(normalized)
        || isProjectImageAnalysisIntent(normalized)
        || isDetailTemplateAuthoringIntent(normalized)
        || isMainImageTemplateAuthoringIntent(normalized)
        || isLayoutReplicationIntent(normalized)
        || matchesSkillRoutingIntent('detail-page-design', normalized)
        || containsAny(normalized, MAIN_IMAGE_PATTERNS);
}

export function normalizeSkillId(skillId?: string): string | undefined {
    return normalizeSharedSkillId(skillId);
}

export function isSkillEnabled(skillId?: string): boolean {
    const normalized = normalizeSkillId(skillId);
    if (!normalized) return false;
    const integrationSettings = useAppStore.getState().integrationSettings;
    return integrationSettings?.skills?.[normalized]?.enabled !== false;
}

export function isSkuIntent(input: string): boolean {
    const normalized = normalizeInput(input);
    const currentTaskText = stripSkuDownstreamContextText(normalized);
    if (isSkuSourceForMainImageIntent(currentTaskText)) return false;
    if (isSkuSourceForNonSkuDocumentTargetText(currentTaskText)) return false;
    if (isAmbiguousSkuSourceExportText(normalized)) return false;
    if (isSkuTemplateDesignRequestText(input)) return false;
    if (!isSkuExecutionRequestText(normalized)) return false;
    if (matchesSkillRoutingIntent('sku-batch', normalized)) return true;
    if (!containsAny(normalized, SKU_PATTERNS)) return false;
    return true;
}

function isSkuSourceForMainImageIntent(input: string): boolean {
    const normalized = normalizeInput(input);
    if (!normalized) return false;
    if (!isMainImageDesignIntent(normalized)) return false;
    if (!/sku/i.test(normalized)) return false;
    return /素材|源文件|来源|使用|用|来自|导出|白底|白底图|自底图|主图/.test(normalized);
}

export function isMainImageDesignIntent(input: string): boolean {
    const normalized = normalizeInput(input);
    return matchesSkillRoutingIntent('main-image-design', normalized)
        || containsAny(normalized, MAIN_IMAGE_PATTERNS);
}

function isDesignReferenceSearchIntent(input: string): boolean {
    const normalized = normalizeInput(input);
    if (!normalized) return false;
    if (containsAny(normalized, DESIGN_REFERENCE_SEARCH_NEGATIVE_PATTERNS)) return false;
    return matchesSkillRoutingIntent('design-reference-search', normalized)
        || containsAny(normalized, DESIGN_REFERENCE_SEARCH_PATTERNS);
}

function extractDesignReferenceSearchQuery(input: string): string {
    const raw = String(input || '').replace(/\r/g, '').trim();
    const previousGoal = String(raw.match(/上一轮用户目标：([^\n]+)/)?.[1] || '').trim();
    const source = (previousGoal || raw).replace(/\s+/g, ' ').trim();
    const cleaned = source
        .replace(/^(帮我|请|麻烦你|那你|你帮我|你)?\s*(去|在)?\s*(eagle|素材库|资源库)?\s*(里|中|内)?\s*(搜索|搜一下|查找|检索|找一些|找一下|找)\s*/i, '')
        .replace(/\s*(相关)?(设计参考|视觉参考|参考案例|参考图|参考|灵感)\s*$/i, '')
        .replace(/的$/, '')
        .replace(/[，。,.!！?？]+$/g, '')
        .trim();
    const query = cleaned || source;
    if (/(参考|视觉|设计|电商|海报|详情页|主图|淘宝|天猫|reference|inspiration)/i.test(query)) {
        return query;
    }
    return `${query} 电商视觉参考`;
}

function extractDesignReferenceSearchRoutingParams(input: string): Record<string, any> {
    return {
        mode: 'search',
        query: extractDesignReferenceSearchQuery(input),
        limit: 8
    };
}

export function isEcommerceSocksDesignIntent(input: string): boolean {
    const normalized = normalizeInput(input);
    if (!normalized) return false;
    return matchesSkillRoutingIntent('ecommerce-socks-design', normalized)
        || containsAny(normalized, ECOMMERCE_SOCKS_DESIGN_PATTERNS);
}

export function isProjectImageAnalysisIntent(input: string): boolean {
    const normalized = normalizeInput(input);
    if (isProjectIdentityConversationIntent(normalized)) return true;
    return matchesSkillRoutingIntent('project-image-analysis', normalized);
}

function isProjectInventoryOverviewIntent(input: string): boolean {
    const normalized = normalizeInput(input);
    if (isProjectIdentityConversationIntent(normalized)) return true;
    if (!normalized || !isProjectImageAnalysisIntent(normalized)) return false;
    return isProjectImageAnalysisInventoryOverviewIntent(normalized);
}

function extractProjectImageAnalysisRoutingParams(input: string): Record<string, any> {
    if (isProjectInventoryOverviewIntent(input)) {
        return {
            analysisMode: 'inventory',
            sampleSize: 0,
            focus: 'inventory'
        };
    }

    return {};
}

export function isSkuNoteOnlyIntent(input: string): boolean {
    return isSkuExecutionRequestText(input) && isSkuNoteOnlyText(input);
}

function extractSkuSizesFromInput(input: string): number[] {
    return extractSkuComboSizesFromText(input);
}

export function isTemplateSaveIntent(input: string): boolean {
    const normalized = normalizeInput(input);
    return matchesSkillRoutingIntent('save-current-template', normalized)
        || containsAny(normalized, TEMPLATE_SAVE_PATTERNS);
}

export function isAgentPanelDebugIntent(input: string): boolean {
    const normalized = normalizeInput(input);
    if (isBasicPhotoshopWriteTask(normalized)) return false;
    return matchesSkillRoutingIntent('agent-panel-bridge', normalized)
        || containsAny(normalized, AGENT_PANEL_PATTERNS)
        || (containsAny(normalized, DEBUG_PATTERNS) && /agent|mcp|\u5de5\u5177\u94fe\u8def|websocket|\u8fde\u63a5|\u9762\u677f|panel/.test(normalized));
}

export function isDetailTemplateAuthoringIntent(input: string): boolean {
    void input;
    return false;
}

export function isMainImageTemplateAuthoringIntent(input: string): boolean {
    void input;
    return false;
}

export function isMainImageLayerGroupStructureIntent(input: string): boolean {
    void input;
    return false;
}

export function isTextFontReplaceIntent(input: string): boolean {
    const normalized = normalizeInput(input);
    return matchesSkillRoutingIntent('text-font-replace', normalized)
        || containsAny(normalized, TEXT_FONT_REPLACE_PATTERNS);
}

export function isLayerManagementIntent(input: string): boolean {
    const normalized = normalizeInput(input);
    return matchesSkillRoutingIntent('layer-management', normalized)
        || containsAny(normalized, LAYER_MANAGEMENT_PATTERNS);
}

export function isFindEditElementIntent(input: string): boolean {
    const normalized = normalizeInput(input);
    if (!matchesSkillRoutingIntent('find-and-edit-element', normalized)
        && !(containsAny(normalized, CANVAS_ELEMENT_TARGET_PATTERNS) && containsAny(normalized, CANVAS_ELEMENT_ACTION_PATTERNS))
        && !isTextContentEditIntent(normalized)) {
        return false;
    }
    if (/图层.{0,8}(顺序|层级|置顶|置底|上移|下移|编组|解除编组|重命名|删除|复制)/i.test(normalized)) {
        return false;
    }
    if (isDocumentManagementIntent(normalized)
        || isDetailTemplateAuthoringIntent(normalized)
        || isMainImageTemplateAuthoringIntent(normalized)
        || isSkuIntent(normalized)) {
        return false;
    }
    return true;
}

export function isMatteIntent(input: string): boolean {
    const normalized = normalizeInput(input);
    return matchesSkillRoutingIntent('matte-product', normalized)
        || containsAny(normalized, MATTE_PATTERNS);
}

function isAttachedReferenceReplicationIntent(
    input: string,
    options?: DeterministicRouteOptions
): boolean {
    if (!options?.hasAttachedImage) return false;
    const normalized = normalizeInput(input);
    if (!containsAny(normalized, ATTACHED_REFERENCE_REPLICATION_PATTERNS)) return false;
    if (isSkuIntent(normalized) || isMatteIntent(normalized) || isLayerManagementIntent(normalized)) return false;
    return true;
}

export function isLayoutReplicationIntent(
    input: string,
    options?: DeterministicRouteOptions
): boolean {
    const normalized = normalizeInput(input);
    return matchesSkillRoutingIntent('layout-replication', normalized)
        || isAttachedReferenceReplicationIntent(normalized, options);
}

export function isDocumentManagementIntent(input: string): boolean {
    const normalized = normalizeInput(input);
    return matchesSkillRoutingIntent('document-management', normalized);
}

export function isRetryFeedbackIntent(input: string): boolean {
    return containsAny(normalizeInput(input), RETRY_FEEDBACK_PATTERNS);
}

function extractQuotedValue(input: string): string | undefined {
    const match = String(input || '').match(/["“”'‘’]([^"“”'‘’\n]+)["“”'‘’]/);
    const value = String(match?.[1] || '').trim();
    return value || undefined;
}

function extractQuotedValues(input: string): string[] {
    const values: string[] = [];
    const pattern = /[“"「『']([^“”"「」『』'\n]{1,80})[”"」』']/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(String(input || '')))) {
        const value = String(match[1] || '').trim();
        if (value) values.push(value);
    }
    return Array.from(new Set(values));
}

function normalizeLayerRoutingName(value: unknown): string | undefined {
    let text = String(value || '').trim();
    text = text.replace(/^[“"「『']|[”"」』']$/g, '').trim();
    text = text.replace(/[，。,.!！?？]+$/g, '').trim();
    text = text.replace(/(?:里|内|里面|中)$/g, '').trim();
    text = text.replace(/(?:图层组|图层|分组|层|组)$/g, '').trim();
    text = text.replace(/[的\s]+$/g, '').trim();
    if (!text) return undefined;
    if (/^(当前|选中|目标|这个|该|的|上方|下方|下面|上面|顺序|层级|图层)$/.test(text)) return undefined;
    return text;
}

function extractLayerName(input: string): string | undefined {
    const quoted = extractQuotedValue(input);
    if (quoted) return quoted;

    const isGenericLayerReference = (value: string): boolean => (
        /^(当前|选中|选中的|已选中|当前选中|当前选中的|目标|这个|该|的|颜色|顺序|层级|排序|置顶|置底|上移|下移|组|图层组|编组|取消编组|解除编组)$/.test(value)
        || /^(顺序|层级|排序).*/.test(value)
    );

    const patterns = [
        /(?:图层|层)\s*(?:叫|名为|名称为|名称是)?\s*([A-Za-z0-9_\-\u4e00-\u9fa5 ]+?)(?:\s*(?:置顶|置底|上移|下移|删除|重命名|改名|复制|拷贝|编组|移到|$))/i,
        /(?:选中|选择|删除|复制|拷贝|重命名|改名)\s*([A-Za-z0-9_\-\u4e00-\u9fa5 ]+?)\s*(?:图层|层)/i
    ];
    for (const pattern of patterns) {
        const match = String(input || '').match(pattern);
        const value = String(match?.[1] || '').trim().replace(/[，。,.!！?？]+$/g, '').trim();
        if (value && !isGenericLayerReference(value)) return value;
    }
    return undefined;
}

function isLayerVisualAnalysisIntent(input: string): boolean {
    const normalized = normalizeInput(input);
    if (!LAYER_VISUAL_ANALYSIS_PATTERN.test(normalized)) return false;
    if (hasPositiveLayerMutationIntent(normalized)) {
        return false;
    }
    return !!extractLayerVisualAnalysisName(input);
}

function hasPositiveLayerMutationIntent(input: string): boolean {
    const normalized = normalizeInput(input);
    const mutationPattern = /(移动|移入|移到|放到|放入|挪到|置顶|置底|上移|下移|编组|解除编组|重命名|改名|删除|复制|拷贝|替换|修改|改动|调整位置|移动位置)/i;
    if (!mutationPattern.test(normalized)) return false;
    const noWriteClauseRemoved = normalized.replace(
        /(?:不要|别|先别|不需要|无需|禁止|不许|不用)[^，,。！？!?；;\n]{0,24}(?:移动|移入|移到|放到|放入|挪到|置顶|置底|上移|下移|编组|解除编组|重命名|改名|删除|复制|拷贝|替换|修改|改动|调整位置|移动位置)[^，,。！？!?；;\n]{0,24}/gi,
        ''
    );
    if (!mutationPattern.test(noWriteClauseRemoved)) return false;
    return true;
}

function extractLayerVisualAnalysisName(input: string): string | undefined {
    const quoted = extractQuotedValue(input);
    if (quoted) return normalizeLayerRoutingName(quoted);

    const raw = String(input || '').trim();
    const patterns = [
        /(?:图层|层)\s*(?:叫|名为|名称为|名称是)?\s*([A-Za-z0-9_\-\u4e00-\u9fa5 ]{1,80}?)(?:\s*(?:这张|这个|该|的|里面|里|中|中的)?\s*(?:图片|图像|图|画面|内容|里面|里|是什么|有什么|看一下|看看|分析|识别|理解))/i,
        /(?:看一下|看看|分析|识别|理解)\s*(?:图层|层)\s*([A-Za-z0-9_\-\u4e00-\u9fa5 ]{1,80}?)(?:\s*(?:这张|这个|该|的|里面|里|中|中的)?\s*(?:图片|图像|图|画面|内容|里面|里|是什么|有什么))/i,
        /([A-Za-z0-9_\-\u4e00-\u9fa5 ]{1,80}?)\s*(?:这个|这张|该)?\s*(?:图层|层)\s*(?:里|里面|中的|的)?\s*(?:图片|图像|图|画面|内容).{0,20}(?:是什么|有什么|看一下|看看|分析|识别|理解)/i
    ];

    for (const pattern of patterns) {
        const match = raw.match(pattern);
        const value = normalizeLayerRoutingName(match?.[1]);
        if (value) return value;
    }
    return undefined;
}

function extractLayerVisualAnalysisRoutingParams(input: string): Record<string, any> {
    const layerName = extractLayerVisualAnalysisName(input);
    return {
        sourceType: 'layer',
        ...(layerName ? { layerName } : {}),
        analysisFocus: /(颜色|配色|色彩)/i.test(input)
            ? 'color'
            : /(构图|版式|位置|排版)/i.test(input)
                ? 'layout'
                : 'elements',
        userIntent: input
    };
}

function extractTargetLayerName(input: string): string | undefined {
    const raw = String(input || '');
    const patterns = [
        /(?:移到|移动到|放到|挪到)\s*(?:图层|层)?\s*([A-Za-z0-9_\-\u4e00-\u9fa5 ]+?)\s*(?:的)?(?:上方|下面|下方|上面)/i,
        /(?:above|below)\s+([A-Za-z0-9_\-\u4e00-\u9fa5 ]+)/i
    ];

    for (const pattern of patterns) {
        const match = raw.match(pattern);
        const value = String(match?.[1] || '')
            .trim()
            .replace(/[，。,.!！?？]+$/g, '')
            .trim();
        if (value && !/^(当前|选中|目标|这个|该|的|上方|下方|下面|上面)$/.test(value)) return value;
    }
    return undefined;
}

function extractMoveToGroupRoutingParams(input: string, baseParams: Record<string, any>): Record<string, any> | null {
    const raw = String(input || '').trim();
    const normalized = normalizeInput(raw);
    if (!/(移入|移动到|移到|放到|放入|挪到|move)/i.test(normalized)) return null;
    if (/(上方|下方|上面|下面|顶层|底层|above|below)/i.test(normalized)) return null;

    const quotedValues = extractQuotedValues(raw);
    let layerName = quotedValues.length > 0 ? String(quotedValues[0] || '').trim() : undefined;
    let targetGroupName = quotedValues.length > 1 ? normalizeLayerRoutingName(quotedValues[1]) : undefined;

    if (!layerName) {
        const sourceMatch = raw.match(/(?:把|将)\s*(.+?)\s*(?:移入|移动到|移到|放到|放入|挪到)/i);
        layerName = normalizeLayerRoutingName(sourceMatch?.[1]);
    }

    if (!targetGroupName) {
        const targetPatterns = [
            /(?:移入|移动到|移到|放到|放入|挪到)\s*[“"「『']?([^“”"「」『』'\n，。!！?？]+?)[”"」』']?\s*(?:里|内|里面|中)?$/i,
            /(?:移入|移动到|移到|放到|放入|挪到).{0,8}到?\s*([A-Za-z0-9_\-\u4e00-\u9fa5 ]{1,40})(?:里|内|里面|中)?$/i
        ];
        for (const pattern of targetPatterns) {
            const match = raw.match(pattern);
            targetGroupName = normalizeLayerRoutingName(match?.[1]);
            if (targetGroupName) break;
        }
    }

    if (!targetGroupName) return null;

    return {
        ...baseParams,
        action: 'move-to-group',
        ...(layerName ? { layerName } : {}),
        targetGroupName
    };
}

function isTextLayerLocationInspectionRequest(input: string): boolean {
    return /(?:文案文本|文案|文字|文本|标题|副标题).{0,32}(?:在哪|哪里|哪个位置|那个位置|哪一层|哪个图层|那个图层|所在图层)/i.test(input)
        || /(?:在哪|哪里|哪个位置|那个位置|哪一层|哪个图层|那个图层|所在图层).{0,32}(?:文案文本|文案|文字|文本|标题|副标题)/i.test(input);
}

function normalizeTextLayerLocationQuery(value: unknown): string | undefined {
    let text = String(value || '').trim();
    text = text.replace(/^(?:请|帮我|帮忙|麻烦|看看|看一下|查一下|查询|找一下|定位一下|确认一下|告诉我)\s*/i, '').trim();
    text = text.replace(/(?:的)?(?:文案文本|文案|文字|文本|标题|副标题).*$/i, '').trim();
    text = text.replace(/(?:在哪|哪里|哪个位置|那个位置|哪一层|哪个图层|那个图层|所在图层).*$/i, '').trim();
    if (!text) return undefined;
    if (/^(当前|这个|那个|文案文本|文案|文字|文本|标题|副标题|图层|位置)$/.test(text)) return undefined;
    return text;
}

function extractTextLayerLocationQuery(input: string): string | undefined {
    const quoted = extractQuotedValue(input);
    if (quoted) return normalizeTextLayerLocationQuery(quoted);

    const raw = String(input || '').trim();
    const patterns = [
        /^(.{1,120}?)(?:\s*的)?(?:文案文本|文案|文字|文本|标题|副标题).{0,32}(?:在哪|哪里|哪个位置|那个位置|哪一层|哪个图层|那个图层|所在图层)/i,
        /^(.{1,120}?)(?:在哪|哪里|哪个位置|那个位置|哪一层|哪个图层|那个图层|所在图层).{0,32}(?:文案文本|文案|文字|文本|标题|副标题)/i
    ];

    for (const pattern of patterns) {
        const match = raw.match(pattern);
        const value = normalizeTextLayerLocationQuery(match?.[1]);
        if (value) return value;
    }

    return undefined;
}

function extractLayerManagementRoutingParams(input: string): Record<string, any> {
    const normalized = normalizeInput(input);
    const params: Record<string, any> = { userIntent: input };

    if (isTextLayerLocationInspectionRequest(normalized)) {
        const textContent = extractTextLayerLocationQuery(input);
        return {
            ...params,
            action: 'inspect',
            inspectMode: 'text-layer-location',
            ...(textContent ? { textContent } : {})
        };
    }

    if (isColorLayerInspectionRequest(normalized)) {
        return { ...params, action: 'inspect', inspectMode: 'color-layers' };
    }

    if (isLayerStateInspectionRequest(normalized)) {
        return { ...params, action: 'inspect' };
    }

    const layerName = extractLayerName(input);
    if (layerName) params.layerName = layerName;
    if (/当前选中|当前选择|选中的|已选中|当前图层/.test(normalized)) {
        params.useCurrentSelection = true;
    }

    const idMatch = String(input || '').match(/(?:layerId|图层\s*ID|图层id|id)\s*[:：=]?\s*(\d+)/i);
    const layerId = Number(idMatch?.[1]);
    if (Number.isFinite(layerId)) params.layerId = layerId;

    const moveToGroupParams = extractMoveToGroupRoutingParams(input, params);
    if (moveToGroupParams) return moveToGroupParams;

    if (/从浅到深/.test(normalized)) {
        return { ...params, action: 'reorder', sortBy: 'lightness', sortDirection: 'light-to-dark' };
    }
    if (/从深到浅/.test(normalized)) {
        return { ...params, action: 'reorder', sortBy: 'lightness', sortDirection: 'dark-to-light' };
    }
    if (/置顶|顶层|bring.*front|to\s*top/i.test(normalized)) {
        return { ...params, action: 'reorder', reorderAction: 'top' };
    }
    if (/置底|底层|send.*back|to\s*bottom/i.test(normalized)) {
        return { ...params, action: 'reorder', reorderAction: 'bottom' };
    }
    if (/上移|向上|move\s*up/i.test(normalized)) {
        return { ...params, action: 'reorder', reorderAction: 'up' };
    }
    if (/下移|向下|move\s*down/i.test(normalized)) {
        return { ...params, action: 'reorder', reorderAction: 'down' };
    }
    if (/移到.*上方|above/i.test(normalized)) {
        const targetLayerName = extractTargetLayerName(input);
        return { ...params, action: 'reorder', reorderAction: 'above', ...(targetLayerName ? { targetLayerName } : {}) };
    }
    if (/移到.*下方|below/i.test(normalized)) {
        const targetLayerName = extractTargetLayerName(input);
        return { ...params, action: 'reorder', reorderAction: 'below', ...(targetLayerName ? { targetLayerName } : {}) };
    }
    if (/重命名|改名|rename/i.test(normalized)) {
        const newNameMatch = String(input || '').match(/(?:重命名为|改名为|名称改为|rename\s+to)\s*([^\n，。!！？?]+)/i);
        const newName = String(newNameMatch?.[1] || '').trim();
        return { ...params, action: 'rename', ...(newName ? { newName } : {}) };
    }
    if (/删除|删掉|delete/i.test(normalized)) {
        return { ...params, action: 'delete' };
    }
    if (/复制|拷贝|duplicate|copy/i.test(normalized)) {
        return { ...params, action: 'duplicate' };
    }
    if (/解除.*编组|取消.*编组|ungroup/i.test(normalized)) {
        return { ...params, action: 'ungroup' };
    }
    if (/编组|group/i.test(normalized)) {
        return { ...params, action: 'group' };
    }
    if (/选中|选择|定位|select|focus/i.test(normalized)) {
        return { ...params, action: 'select' };
    }
    return { ...params, action: 'inspect' };
}

function extractFindEditElementRoutingParams(input: string): Record<string, any> {
    const raw = String(input || '').trim();
    const normalized = normalizeInput(raw);
    const params: Record<string, any> = {
        userIntent: raw,
        selectionMode: 'auto'
    };

    const idMatch = raw.match(/(?:layerId|图层\s*ID|图层id|id)\s*[:：=]?\s*(\d+)/i);
    const layerId = Number(idMatch?.[1]);
    if (Number.isFinite(layerId)) params.layerId = layerId;

    const setTextMatch = raw.match(/(?:改成|改为|替换成|换成|写成|设置为|修改为)\s*[“"']?([^“”"'\n。！？]+)[”"']?/i);
    if (setTextMatch?.[1]) {
        params.action = 'setText';
        params.text = setTextMatch[1].trim()
            .replace(/[。！？]+$/g, '')
            // 去掉用户末尾追加的文档/位置上下文（如「堆堆薄款 文档是 详情页」→「堆堆薄款」），避免污染写入的新文；
            // 要求前置空白/逗号才截，避免误伤正文里正常出现的「文档/在」等字。
            .replace(/[\s，,]+(?:文档|文件)\s*[是为叫:：].*$/,'')
            .trim();
    } else if (/去除|去掉|移除|隐藏|不显示|取消显示|拿掉/i.test(normalized)) {
        params.action = 'hide';
    } else if (/换图|替换图片|replace.*image/i.test(normalized)) {
        params.action = 'replaceImage';
    } else if (/放大|缩小|缩放|scale/i.test(normalized)) {
        params.action = 'scale';
        const scaleMatch = raw.match(/(\d+(?:\.\d+)?)\s*%/);
        if (scaleMatch?.[1]) params.scalePercent = Number(scaleMatch[1]);
    } else if (/透明度|不透明度|opacity/i.test(normalized)) {
        params.action = 'setOpacity';
        const opacityMatch = raw.match(/(\d+(?:\.\d+)?)\s*%?/);
        if (opacityMatch?.[1]) params.opacity = Number(opacityMatch[1]);
    } else if (/混合模式|blend/i.test(normalized)) {
        params.action = 'setBlendMode';
    } else if (/移动|挪到|move/i.test(normalized)) {
        params.action = 'move';
    } else if (/选中|选择|定位|select|locate/i.test(normalized)) {
        params.action = /选中|选择|select/i.test(normalized) ? 'select' : 'locate';
    } else {
        params.action = 'locate';
    }

    const hideTargetMatch = params.action === 'hide'
        ? raw.match(/(?:去除|去掉|移除|隐藏|不显示|取消显示|拿掉)\s*([^\n，。!！？?]+)/i)
        : null;
    const targetPart = String(hideTargetMatch?.[1] || '').trim() || raw
        .replace(/帮我|请|把|将/g, '')
        .split(/(?:改成|改为|替换成|换成|写成|设置为|修改为|移动|挪到|放大|缩小|缩放|透明度|不透明度|混合模式|换图|替换图片|选中|选择|定位|去除|去掉|移除|隐藏|不显示|取消显示|拿掉)/i)[0]
        ?.trim()
        .replace(/[，,。.!！?？]+$/g, '');
    params.targetDescription = targetPart || raw;

    return params;
}

function matchDeclaredAutonomousWorkflowIntent(input: string): DeterministicIntentMatch | null {
    const match = findSkillRoutingIntent(input);
    if (!match || !isControlledRouteAutonomousEntrySkill(match.skillId)) return null;

    const mode = match.mode === 'inspect' || match.mode === 'execute'
        ? match.mode
        : undefined;
    return {
        skillId: match.skillId,
        mode,
        params: { userIntent: input }
    };
}

function matchDeterministicIntent(
    input: string,
    options?: DeterministicRouteOptions
): DeterministicIntentMatch | null {
    const normalized = normalizeInput(input);
    if (isAgentSkillCapabilityQuestion(input)) return null;
    const intentControlPlane = options?.intentControlPlane || buildAgentIntentControlPlaneDecision({
        userInput: input,
        hasImageInput: options?.hasAttachedImage
    });
    if (intentControlPlane.toolScope === 'none'
        || intentControlPlane.shouldUseConversationalPath
        || !intentControlPlane.allowsDeterministicRoute) {
        return null;
    }
    if (
        intentControlPlane.requestKind === 'autonomous_execution'
        && intentControlPlane.matchedSignals?.includes('sku_placeholder_adjustment') === true
    ) {
        return null;
    }
    if (
        isBasicPhotoshopWriteTask(normalized)
        && intentControlPlane.matchedSignals?.includes('basic_photoshop_write_task') === true
    ) {
        return null;
    }

    if (isSkuNoteOnlyIntent(normalized)) {
        return {
            skillId: 'sku-batch',
            params: {
                onlyNotes: true,
                comboSizes: extractSkuSizesFromInput(input)
            }
        };
    }

    if (isSkuIntent(normalized)) {
        const declaredWorkflowIntent = matchDeclaredAutonomousWorkflowIntent(input);
        if (declaredWorkflowIntent) return declaredWorkflowIntent;
        return { skillId: 'sku-batch' };
    }

    if (isProjectImageAnalysisIntent(normalized)) {
        return {
            skillId: 'project-image-analysis',
            params: extractProjectImageAnalysisRoutingParams(input)
        };
    }

    if (isTemplateInventoryInspectionIntent(normalized)) {
        return {
            skillId: 'project-image-analysis',
            params: {
                analysisMode: 'inventory',
                sampleSize: 0,
                focus: 'inventory',
                userIntent: input
            }
        };
    }

    if (isAgentPanelDebugIntent(normalized)) {
        return { skillId: 'agent-panel-bridge' };
    }

    if (isTextFontReplaceIntent(normalized)) {
        return { skillId: 'text-font-replace' };
    }

    // 显式详情页业务意图不被单图层视觉分析抢走；当前文档结构不在 R0 前调用业务解析器猜测。
    if (
        isLayerVisualAnalysisIntent(normalized)
        && !matchesSkillRoutingIntent('detail-page-design', normalized)
    ) {
        return {
            skillId: 'visual-analysis',
            mode: 'inspect',
            params: extractLayerVisualAnalysisRoutingParams(input)
        };
    }

    if (isLayerManagementIntent(normalized)) {
        const params = extractLayerManagementRoutingParams(input);
        if (
            params.action === 'move-to-group'
            && !params.layerId
            && !params.layerName
            && params.useCurrentSelection !== true
        ) {
            return null;
        }
        if (
            params.action === 'inspect'
            && !params.layerId
            && !params.layerName
            && /(移动|移入|移到|放到|放入|挪到)/i.test(normalized)
            && /(图层|层|组)/i.test(normalized)
        ) {
            return null;
        }
        return {
            skillId: 'layer-management',
            params
        };
    }

    if (isFindEditElementIntent(normalized)) {
        return {
            skillId: 'find-and-edit-element',
            params: extractFindEditElementRoutingParams(input)
        };
    }

    if (isDocumentManagementIntent(normalized)) {
        // “另存为/导出到”经常只是设计任务的交付条件。只有在前面的精准原子编辑
        // 均未命中后，才让声明式业务工作流覆盖 document-management，避免保存动作抢主目标。
        const declaredWorkflowIntent = matchDeclaredAutonomousWorkflowIntent(input);
        if (declaredWorkflowIntent) return declaredWorkflowIntent;
        const action = resolveSkillRoutingMode('document-management', normalized);
        if (!action) return null;
        return {
            skillId: 'document-management',
            params: extractDocumentManagementRoutingParams(input, action)
        };
    }

    if (isDesignReferenceSearchIntent(normalized)) {
        return {
            skillId: 'design-reference-search',
            params: extractDesignReferenceSearchRoutingParams(input)
        };
    }

    if (isLayoutReplicationIntent(normalized, options)) {
        return {
            skillId: 'layout-replication',
            params: {
                outputMode: 'apply',
                autoCreateDocument: true,
                preserveReferenceCanvasSize: true,
                artifactKind: inferReferenceReplicationArtifactKind(input),
                userIntent: input
            }
        };
    }

    if (isEcommerceSocksDesignIntent(normalized)) {
        return {
            skillId: 'ecommerce-socks-design',
            params: {
                deliverables: extractEcommerceSocksDeliverables(input),
                userIntent: input
            }
        };
    }

    if (matchesSkillRoutingIntent('detail-page-design', normalized)) {
        return {
            skillId: 'detail-page-design',
            mode: resolveSkillRoutingMode('detail-page-design', normalized) === 'inspect'
                ? 'inspect'
                : 'execute'
        };
    }

    if (matchesSkillRoutingIntent('main-image-design', normalized)) {
        return {
            skillId: 'main-image-design',
            mode: 'execute'
        };
    }

    if (isMatteIntent(normalized) && !isAgentMattingPaused()) {
        return { skillId: 'matte-product' };
    }

    if (isTemplateSaveIntent(normalized)) {
        return { skillId: 'save-current-template' };
    }

    return null;
}

export function inferSkillHint(input: string): string | undefined {
    const deterministicMatch = matchDeterministicIntent(input);
    if (deterministicMatch?.skillId) return deterministicMatch.skillId;

    const normalized = normalizeInput(input);
    if (containsAny(normalized, MAIN_IMAGE_PATTERNS)) return 'main-image-design';
    return undefined;
}

export function detectLightweightIntent(
    input: string,
    intentControlPlane?: AgentIntentControlPlaneDecision
): LightweightIntent {
    const text = normalizeInput(input);
    if (!text) return 'none';

    if (GREETING_PATTERN.test(text)) return 'greeting';
    if (THANKS_PATTERN.test(text)) return 'thanks';
    if (CONTINUATION_PATTERN.test(text)) return 'continuation';
    if (ACK_PATTERN.test(text)) return 'ack';
    if (SELF_INTRODUCTION_PATTERN.test(text)) return 'identity';
    if (containsAny(text, MODEL_COMPARISON_PATTERNS)) return 'model_compare';
    if (containsAny(text, MODEL_IDENTITY_PATTERNS)) return 'identity';
    if (CAPABILITY_QUESTION_PATTERN.test(text) || isAgentSkillCapabilityQuestion(input)) return 'capability';
    if (containsAny(text, TASK_SUMMARY_PATTERNS)) return 'task_summary';
    if (ARCHITECTURE_DISCUSSION_PATTERN.test(text)) return 'chat';
    const resolvedIntentControlPlane = intentControlPlane
        || buildAgentIntentControlPlaneDecision({ userInput: text });
    if (resolvedIntentControlPlane.shouldUseConversationalPath) return 'chat';
    if (resolvedIntentControlPlane.requiresClarificationBeforeTools
        || resolvedIntentControlPlane.requestKind === 'read_only_inspect'
        || resolvedIntentControlPlane.requestKind === 'execute_skill'
        || resolvedIntentControlPlane.requestKind === 'autonomous_execution'
        || resolvedIntentControlPlane.requestKind === 'uxp_user_tool_only') {
        return 'none';
    }
    if (isPlanOrDiscussionQuestion(text)) return 'chat';
    if (isProjectImageAnalysisIntent(text)) return 'none';
    if (isActionableBusinessRequest(text)) return 'none';
    const deterministicMatch = matchDeterministicIntent(text);
    if (shouldRouteQuestionToDeterministicSkill(deterministicMatch)) return 'none';
    if (isGeneralChatQuestion(text)) return 'chat';
    return 'none';
}

export function isModelFirstConversationalIntent(intent: LightweightIntent): boolean {
    return intent !== 'none';
}

export function isLocalFirstConversationalIntent(intent: LightweightIntent): boolean {
    void intent;
    return false;
}

function resolveSkillThinkingMessage(
    skillId: string,
    phase: 'deterministic' | 'autonomous'
): string | undefined {
    const skill = getSkillById(skillId);
    const message = skill?.routing?.routeStatusMessages?.[phase];
    return typeof message === 'string' && message.trim() ? message.trim() : undefined;
}

export function buildDeterministicIntentMessage(skillId: string, input: string): string {
    if (normalizeSkillId(skillId) === 'matte-product' && isAgentMattingPaused()) {
        return getAgentMattingPausedMessage();
    }

    if (skillId === 'sku-batch' && isSkuNoteOnlyIntent(input)) {
        return '确认当前项目、SKU 文档和自选备注模板后生成备注。';
    }

    if (skillId === 'project-image-analysis' && isProjectInventoryOverviewIntent(input)) {
        return '读取项目资源索引，汇总文件夹、图片和素材类型。';
    }

    if (skillId === 'project-image-analysis' && isTemplateInventoryInspectionIntent(input)) {
        return '读取项目资源索引，统计模板文件和相关素材。';
    }

    const sharedMessage = resolveSkillThinkingMessage(skillId, 'deterministic');
    if (sharedMessage) {
        return sharedMessage;
    }

    return '确认目标和当前上下文后执行。';
}

export function buildAutonomousIntentMessage(input: string, skillHint?: string): string {
    const resolvedSkillHint = skillHint || inferSkillHint(input);

    if (normalizeSkillId(resolvedSkillHint) === 'matte-product' && isAgentMattingPaused()) {
        return getAgentMattingPausedMessage();
    }

    if (resolvedSkillHint) {
        const sharedMessage = resolveSkillThinkingMessage(resolvedSkillHint, 'autonomous');
        if (sharedMessage) {
            return sharedMessage;
        }
    }

    return '理解用户需求、当前画面和可用素材后处理。';
}

export function fastDeterministicRoute(
    input: string,
    options?: DeterministicRouteOptions
): DeterministicSkillRoute | null {
    const match = matchDeterministicIntent(input, options);
    if (!match?.skillId) return null;

    return {
        skillId: match.skillId,
        skillParams: applySharedSkillParamDefaults({
            skillId: match.skillId,
            userInput: input,
            mode: match.mode,
            params: match.params
        }),
        thinking: buildDeterministicIntentMessage(match.skillId, input)
    };
}

export function debugInferDecisionFromText(userInput: string): AgentDecision {
    const intent = detectLightweightIntent(userInput);
    if (intent !== 'none') {
        return {
            type: 'direct_response',
            directResponse: '这条输入会直接走对话回复，不会触发桌面端智能体执行。',
            reasoning: `lightweight:${intent}`
        };
    }

    const route = fastDeterministicRoute(userInput);
    if (route) {
        return {
            type: 'skill_execution',
            skillId: route.skillId,
            skillParams: route.skillParams,
            reasoning: route.thinking
        };
    }

    return {
        type: 'skill_execution',
        skillId: 'autonomous-agent',
        skillParams: {
            userTask: userInput,
            skillId: inferSkillHint(userInput)
        },
        reasoning: buildAutonomousIntentMessage(userInput, inferSkillHint(userInput))
    };
}
