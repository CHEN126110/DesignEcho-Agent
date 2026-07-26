#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
require('ts-node').register({ transpileOnly: true, project: path.resolve(__dirname, '..', 'tsconfig.main.json') });

const repoRoot = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function assertNoInternalAssetVocabulary(value, label) {
  assert(
    !/\b(?:raw_photo|finished_design|raw-model-wear|raw-product-still|raw-detail-closeup|color-single)\b/i.test(String(value || '')),
    label
  );
}

const {
  cleanAssistantFailureErrorText,
  cleanAssistantFailureMessageText,
  formatAssistantBusinessVisualFeedbackContent,
  formatAssistantFailureContent,
  cleanAssistantResponseContent,
  sanitizeUserVisibleAgentText,
  sanitizeUserVisibleAssistantBodyText,
  sanitizeUserVisibleDiagnosticText,
  sanitizeUserVisibleThinkingText,
  finalizeUserVisibleThinkingText
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'chat-response-cleaner.ts'));
const {
  normalizeStreamTextChunk
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'stream-text-normalizer.ts'));

const appStoreSource = read('src/renderer/stores/app.store.ts');
const conversationalSource = read('src/renderer/services/agent-orchestration/conversational.ts');
const MODEL_UNAVAILABLE_COPY = '这次没有拿到模型回复，先不继续处理。';

const leakedToolXml = [
  '好的，让我分析一下项目中的图片内容。',
  '<tool_call>',
  '<function=visual_analysis>',
  '<parameter=analysis_type>content_overview</parameter>',
  '<parameter=include_details>True</parameter>',
  '<parameter=project_name>current</parameter>',
  '</function>',
  '</tool_call>'
].join('\n');

const cleanedLeak = cleanAssistantResponseContent(leakedToolXml);
assert(cleanedLeak.includes('好的，让我分析一下项目中的图片内容。'), 'natural prefix should be preserved');
assert(!cleanedLeak.includes('<tool_call>'), 'tool_call tag should be removed');
assert(!cleanedLeak.includes('<function='), 'function tag should be removed');
assert(!cleanedLeak.includes('<parameter='), 'parameter tag should be removed');

const onlyToolXml = cleanAssistantResponseContent([
  '<tool_call>',
  '<function=visual_analysis>',
  '<parameter=analysis_type>content_overview</parameter>',
  '</function>',
  '</tool_call>'
].join('\n'));
assert.strictEqual(onlyToolXml, '', 'pure tool-call markup should not become visible chat text');

const partialToolXml = sanitizeUserVisibleAgentText([
  '好的，我先看一下项目图片。',
  '<tool_call>',
  '<function=visual_analysis>',
  '<parameter=analysis_type>content_overview</parameter>'
].join('\n'));
assert(partialToolXml.includes('好的，我先看一下项目图片。'), 'partial tool-call XML should preserve natural prefix');
assert(!partialToolXml.includes('<tool_call'), 'partial tool-call XML must not leak tool_call tag');
assert(!partialToolXml.includes('<function='), 'partial tool-call XML must not leak function tag');
assert(!partialToolXml.includes('analysis_type'), 'partial tool-call XML must not leak parameter body');

const partialRouterJson = sanitizeUserVisibleAgentText('{"route":"skill_execution","skillId":"visual-analysis"');
assert.strictEqual(partialRouterJson, '', 'partial router JSON should not be visible during streaming');

const photoshopLayerIdSummary = sanitizeUserVisibleAgentText(
  '已经成功删除了 `layerId` 为 6 的图层 "Agent Duplicate To Delete"。原始文字图层 "Agent Text Layer" (layerId: 5) 和矩形图层保持不变。'
);
assert(!/layerId|ID\s*为\s*\d+/i.test(photoshopLayerIdSummary), 'user-visible Photoshop summaries must not expose layerId wording');
assert(photoshopLayerIdSummary.includes('对应图层') || photoshopLayerIdSummary.includes('图层'), 'layerId wording should be rewritten into natural layer wording');

const photoshopToolNameSummary = sanitizeUserVisibleAgentText(
  '下一步会调用 createTextLayer 和 getLayerHierarchy；不要把工具调用写成 Markdown 文本，也不要输出 tool_calls。'
);
for (const forbidden of ['createTextLayer', 'getLayerHierarchy', 'tool_calls', 'Markdown']) {
  assert(!photoshopToolNameSummary.includes(forbidden), `user-visible summaries must rewrite internal operation wording: ${forbidden}`);
}
assert(photoshopToolNameSummary.includes('创建文本图层') && photoshopToolNameSummary.includes('读取图层结构'), 'tool names should become designer-facing operation names');

const cannedCapabilityTemplate = sanitizeUserVisibleAssistantBodyText(
  '我可以协助这些设计工作：主图、点击图、转化图和白底图规划、SKU 组合图和自选备注、详情页设计、模板检查和模板创建、项目图片理解、素材概览和设计参考检索、参考图复刻、图层、文档、文字和字体处理、电商袜子整套设计编排。你可以直接提出主图、SKU、详情页、项目图片理解、文档保存或图层调整需求；我会先判断它属于对话、只读检查还是需要进入处理流程。'
);
assert.strictEqual(cannedCapabilityTemplate, '', 'streamed canned capability menu must be suppressed before it reaches the chat body');

const partialCannedCapabilityPrefix = sanitizeUserVisibleAssistantBodyText('我可以协助这些设计工作：');
assert.strictEqual(partialCannedCapabilityPrefix, '', 'partial streamed canned capability prefix must be suppressed immediately');

const shortPartialCannedCapabilityOpening = sanitizeUserVisibleAssistantBodyText('我可以协助');
assert.strictEqual(shortPartialCannedCapabilityOpening, '', 'short streamed canned capability opening must be buffered before it flashes');

const partialCannedCapabilityList = sanitizeUserVisibleAssistantBodyText(
  '我可以协助这些设计工作：主图、点击图、转化图和白底图规划、SKU'
);
assert.strictEqual(partialCannedCapabilityList, '', 'partial streamed canned capability list must not flash before repair');

const genericCrossDomainCapabilityMenu = sanitizeUserVisibleAssistantBodyText(
  '我能帮你完成主图、点击图、转化图、白底图、SKU 组合图和自选备注、详情页长图这些设计任务；你可以直接告诉我需要哪一项，我会先判断后进入处理流程。'
);
assert.strictEqual(genericCrossDomainCapabilityMenu, '', 'generic cross-domain capability menu must be suppressed before final repair');

const formulaicSkuCapabilityExplainer = sanitizeUserVisibleAssistantBodyText(
  '会的，SKU组合图是我的常用能力之一。简单来说，我能帮你做的是：根据项目里的SKU配置和素材，批量生成各规格的组合图；如果有多件规格（比如2双、3双、4双），还会自动生成对应的自选备注图。你直接说要做什么就行，我会先读取当前项目资料，看看素材和配置情况，然后给你一个执行方案。'
);
assert.strictEqual(formulaicSkuCapabilityExplainer, '', 'streamed formulaic SKU capability explainer must be suppressed before final repair');

const concreteDetailPageBlockedReport = sanitizeUserVisibleAssistantBodyText(
  [
    '**任务报告：详情页创建受阻**',
    '',
    '**当前状态：**',
    '- 已完成设计调研：获取了详情页设计方法论、项目素材分析和设计方向。',
    '- 已确定设计方向：简约清新风格，米白、浅咖、灰色中性色系。',
    '- **阻塞点：无法创建新文档**',
    '',
    '**问题说明：**',
    '尝试创建名为「详情页」的 790x2000px 文档时，当前 Photoshop 没有返回可用的新文档。',
    '',
    '**下一步：**',
    '需要先恢复 Photoshop 创建文档能力，再继续进入画面观察和排版调整。'
  ].join('\n')
);
assert(
  concreteDetailPageBlockedReport.includes('详情页创建受阻')
    && concreteDetailPageBlockedReport.includes('无法创建新文档')
    && concreteDetailPageBlockedReport.includes('下一步'),
  'concrete task reports that mention project materials and next steps must not be suppressed as formulaic capability menus'
);

const concreteDetailPagePlanUsingSkuSource = sanitizeUserVisibleAssistantBodyText(
  '计划基于项目中的 SKU 色卡素材，创建一个名为“详情页”的新文档。版面结构将采用电商详情页常见的长图模块化布局，顶部放置主视觉或核心卖点，中部依次展开产品细节、材质工艺、尺码规格等模块，底部为品牌信息或售后说明。素材来源将直接调用项目内已有的 SKU 色卡图片，并根据模块内容进行裁剪、排版和文案搭配。下一步将检查版面节奏、图文比例和移动端阅读体验，确保信息层级清晰。'
);
assert(
  concreteDetailPagePlanUsingSkuSource.includes('名为“详情页”的新文档')
    && concreteDetailPagePlanUsingSkuSource.includes('SKU 色卡素材')
    && concreteDetailPagePlanUsingSkuSource.includes('下一步'),
  'concrete detail-page design plans may mention SKU material sources and next steps without being suppressed'
);

const groundedProjectUnderstandingReply = sanitizeUserVisibleAssistantBodyText(
  [
    '根据项目资源索引，我观察到当前项目包含 **38 个图片/素材**，分布在 **10 个文件夹** 中，主要涉及 **3 类资源**。',
    '',
    '从文件夹结构来看，这很可能是一个 **服装电商产品项目**，核心内容是 **“SCS1270桑蚕丝波浪镂空”** 这个款式。具体来说：',
    '',
    '1. **核心产品素材**：在 `SCS1270桑蚕丝波浪镂空` 文件夹下有 **32 张** 产品图片（如 `HJT_3829.jpg` 等），这应该是该款式的主图、细节图或模特图。',
    '2. **颜色变体**：在 `新建文件夹` 中，有 **4 张** 以颜色命名的图片（奶白、本白、灰色、黑色），这很可能是该款式的不同颜色选项。',
    '3. **电商页面元素**：',
    '   * `主图` 文件夹有 **2 张** 图片（`TM.png` 和 `白底.jpg`），这是典型的电商主图素材。',
    '   * `PSD` 文件夹有一个 `SKU.psb` 文件，这可能是用于制作SKU详情图或价格标签的模板。',
    '   * 还有 `SKU`、`主图/750`、`主图/800`、`主图视频` 等文件夹，虽然目前为空，但结构上符合电商详情页的常见分类。',
    '',
    '**我的判断**：这是一个为 **“SCS1270桑蚕丝波浪镂空”** 这款服装准备的电商项目，素材已初步归类，但部分文件夹（如SKU、主图视频）尚未填充内容。',
    '',
    '**下一步建议**：',
    '* 如果您想了解这款产品的具体外观、卖点或设计细节，我可以进一步分析 `SCS1270桑蚕丝波浪镂空` 文件夹下的图片内容。',
    '* 如果您需要整理或优化项目结构，我可以帮您检查空文件夹的用途或建议更清晰的分类方式。',
    '',
    '您想先从哪个方面开始呢？'
  ].join('\n')
);
assert(
  groundedProjectUnderstandingReply.includes('根据项目资源索引')
    && groundedProjectUnderstandingReply.includes('38 个图片')
    && groundedProjectUnderstandingReply.includes('SKU.psb')
    && groundedProjectUnderstandingReply.includes('我的判断'),
  'grounded project understanding replies must not be suppressed as canned capability menus just because they mention 主图/SKU/详情页/下一步'
);

const groundedProjectInventoryReply = sanitizeUserVisibleAssistantBodyText(
  [
    '我查看了你的项目资源结构，目前项目里共有 **38 个图片/素材**，分布在 **10 个文件夹**中，主要包含以下内容：',
    '',
    '**主要文件夹和资源：**',
    '1. **SCS1270桑蚕丝波浪镂空**：这是最大的文件夹，里面有 **32 张图片**，看起来是产品实拍图或细节图（例如 HJT_3829.jpg 等）。里面还有一个“新建文件夹”，包含 4 张不同颜色的图片（奶白、本白、灰色、黑色）。',
    '2. **主图**：有 **2 张图片**，分别是 `TM.png` 和 `白底.jpg`，这应该是用于电商平台的主图素材。',
    '3. **PSD**：包含 **1 个 PSD 文件**（SKU.psb），这可能是用于编辑的源文件。',
    '4. **其他文件夹**：如 `SKU`、`主图/750`、`主图/800`、`主图视频`、`模板文件`、`配置文件` 等文件夹目前都是空的。',
    '',
    '**我的判断和建议：**',
    '从结构上看，这个项目的核心素材集中在“SCS1270桑蚕丝波浪镂空”这个产品系列上，已经准备了多角度的实拍图和不同颜色的选项。主图也有了基础版本。',
    '',
    '**下一步建议：**',
    '如果你需要我进一步分析这些图片的具体内容（比如判断款式风格、提炼产品卖点，或者看看主图的设计是否合适），我可以深入查看这些图片。你想先从哪个部分开始看呢？'
  ].join('\n')
);
assert(
  groundedProjectInventoryReply.includes('我查看了你的项目资源结构')
    && groundedProjectInventoryReply.includes('38 个图片')
    && groundedProjectInventoryReply.includes('SKU.psb')
    && groundedProjectInventoryReply.includes('我的判断和建议'),
  'grounded project inventory replies must not be suppressed as formulaic capability explainers'
);

const groundedProjectResourceReply = sanitizeUserVisibleAssistantBodyText(
  [
    '我查看了你的项目资源，发现这是一个关于“SCS1270桑蚕丝波浪镂空”产品的设计项目。目前项目里总共有 **38 个图片/素材**，分布在 **10 个文件夹** 中。',
    '从结构上看，主要资源集中在以下几个地方：',
    '1. **产品图片**：核心文件夹是 `SCS1270桑蚕丝波浪镂空`，里面有 **32 张** 产品实拍图（比如 HJT_3829.jpg 等）。另外还有一个子文件夹，里面按颜色（奶白、本白、灰色、黑色）整理了 **4 张** 图片。',
    '2. **主图**：`主图` 文件夹里有 **2 张** 图片，分别是 `TM.png` 和 `白底.jpg`，这应该是用于电商平台的主图素材。',
    '3. **设计源文件**：`PSD` 文件夹里有一个 `SKU.psb` 文件，这可能是用于制作SKU图的源文件。',
    '不过，目前系统只完成了资源索引，还没有深入分析这些图片的具体内容（比如款式细节、卖点等）。',
    '**我的建议是**：如果你想进一步了解这些图片具体展示了什么，我可以帮你进入下一步，对这些图片进行内容分析。你希望我先从哪部分开始看呢？'
  ].join('\n')
);
assert(
  groundedProjectResourceReply.includes('我查看了你的项目资源')
    && groundedProjectResourceReply.includes('38 个图片')
    && groundedProjectResourceReply.includes('SKU.psb')
    && groundedProjectResourceReply.includes('我的建议是'),
  'grounded project resource replies must not be suppressed when they include concrete project details and next-step suggestions'
);

const greetingPollutedSkuCapabilityMenu = sanitizeUserVisibleAssistantBodyText(
  '你好！我是你的电商视觉设计搭档。 关于你刚才问的 SKU 制作，这正是我擅长的领域。我可以帮你处理以下几类工作： 1. SKU 组合图生成：根据你提供的单品素材，自动生成不同规格（如单双、多双装）的组合排版。 2. 自选备注图制作：针对电商常见的“自选备注”需求，我可以按照 2-3-4 双等规格批量生成对应的备注说明图。 3. 规格标准化导出：统一调整素材的大小、位置和背景，确保全套 SKU 视觉风格一致。 你可以直接告诉我你目前的素材情况（比如有几款颜色、几种规格）以及想要的排版样式，我先为你规划一套出图方案。如果你有参考图，也可以发给我。'
);
assert.strictEqual(greetingPollutedSkuCapabilityMenu, '', 'greeting polluted by stale SKU capability menu must be suppressed');

const promptInstructionLeak = sanitizeUserVisibleAssistantBodyText(
  '## 用户这次问到的能力范围 用户只是在问某一项能力，不是让你现在开始处理文件。不要输出 JSON，不要输出工具名。'
);
assert.strictEqual(promptInstructionLeak, '', 'model replies that repeat internal prompt instructions must not be shown to users');

const legacyModelSlotFailure = sanitizeUserVisibleAssistantBodyText(
  '未找到可用模型：你在【布局分析/主逻辑】能力槽没有解析到可用的模型。'
);
assert(
  !legacyModelSlotFailure.includes('能力槽') && legacyModelSlotFailure.includes('主模型设置'),
  'legacy capability-slot wording must be rewritten as the user-facing main-model setting'
);

const legacyRuntimeStageBlocker = sanitizeUserVisibleDiagnosticText(
  'Runtime Session 的 R5 尚未通过（unobserved），不能把工具结果声明为任务完成。'
);
assert.strictEqual(
  legacyRuntimeStageBlocker,
  '本轮处理已经结束，但最终画面还没有完成复核，暂时不能确认任务已经完成。',
  'persisted runtime-stage blockers must be rewritten as designer-facing review copy'
);
assert(
  !/Runtime|R5|unobserved|当前处理 的 当前阶段/i.test(legacyRuntimeStageBlocker),
  'runtime-stage implementation vocabulary must not reach the user-facing result'
);
const persistedSanitizedRuntimeStageBlocker = sanitizeUserVisibleDiagnosticText(
  '当前处理 的 当前阶段 尚未通过（unobserved），不能把工具结果声明为任务完成。'
);
assert.strictEqual(
  persistedSanitizedRuntimeStageBlocker,
  '本轮处理已经结束，但最终画面还没有完成复核，暂时不能确认任务已经完成。',
  'already-persisted legacy blocker copy must be repaired when old conversations reload'
);

const internalThinkingLeaks = [
  'direct_response',
  'needs_model_design_decision',
  'agentTaskPlan matchedSignals skillId=sku-layout',
  '<tool_call><function=visual_analysis></function></tool_call>',
  '用户这次问到的能力范围：不要输出 JSON，不要输出工具名。',
  'Runtime Session 已进入 R3，Harness 正在检查 manifest 和能力槽。'
];
for (const leak of internalThinkingLeaks) {
  assert.strictEqual(
    sanitizeUserVisibleThinkingText(leak),
    '',
    `internal thinking leak must not enter thinking panel: ${leak}`
  );
}

const publicThinkingSummary = sanitizeUserVisibleThinkingText('我先按 SKU 能力咨询理解，不会因为这句话去改动画面。');
assert.strictEqual(
  publicThinkingSummary,
  '我先按 SKU 能力咨询理解，不会因为这句话去改动画面。',
  'short public reasoning summary should remain visible'
);

let cumulativeThinking = '';
const emittedThinkingDeltas = [];
for (const snapshot of ['用户', '用户指', '用户指出了校', '用户指出了校验问题。']) {
  const normalized = normalizeStreamTextChunk(cumulativeThinking, snapshot);
  cumulativeThinking = normalized.fullText;
  if (normalized.deltaText) emittedThinkingDeltas.push(normalized.deltaText);
}
assert.strictEqual(
  cumulativeThinking,
  '用户指出了校验问题。',
  'cumulative provider snapshots must settle to one full thinking string'
);
assert.strictEqual(
  emittedThinkingDeltas.join(''),
  '用户指出了校验问题。',
  'cumulative provider snapshots must be emitted as true deltas without prefix snowballing'
);

assert.strictEqual(
  sanitizeUserVisibleThinkingText('用户指出了校验问题：inputCoverage[3] 的 contextRefs 未声明，readiness=ready。'),
  '',
  'Harness schema repair narration must not enter the user Thinking panel'
);
assert.strictEqual(
  finalizeUserVisibleThinkingText('当前文档不是目标 SKU 色卡文档，需要新建 1500×1500 文档。先调用decl'),
  '当前文档不是目标 SKU 色卡文档，需要新建 1500×1500 文档。',
  'streaming Thinking must publish complete design-facing sentences instead of an unfinished internal call name'
);

let visibleProviderThinking = '';
for (const snapshot of [
  '错误分析：',
  '错误分析：\n- `input',
  '错误分析：\n- `inputCoverage.contextRefs` 不能引用 context:user_goal。'
]) {
  const visibleSnapshot = finalizeUserVisibleThinkingText(snapshot, { requireSentenceBoundary: true });
  if (visibleSnapshot) visibleProviderThinking = visibleSnapshot;
}
assert.strictEqual(
  visibleProviderThinking,
  '',
  'cumulative provider Thinking must not leave an early partial prefix when the completed text is internal'
);
assert.strictEqual(
  finalizeUserVisibleThinkingText('画面重点已经明确', { requireSentenceBoundary: true }),
  '',
  'provider Thinking deltas must wait for a stable sentence boundary'
);
assert.strictEqual(
  sanitizeUserVisibleThinkingText('画面重点已经明确'),
  '画面重点已经明确',
  'the final provider Thinking snapshot must preserve a complete design judgment without punctuation'
);

const englishRuntimeMonologue = [
  'The current document is detail.psb. I need to create a new document.',
  'The system is blocking my attempt to create a document.',
  'The system is blocking my attempt to create a document.',
  'The system is blocking my attempt to create a document.'
].join(' ');
assert.strictEqual(
  sanitizeUserVisibleThinkingText(englishRuntimeMonologue),
  '',
  'English-dominant repetitive runtime monologue must not enter the user Thinking panel'
);

for (const fragment of ['First blue', 'From the snapshot', 'Now I need to']) {
  assert.strictEqual(
    sanitizeUserVisibleThinkingText(fragment),
    '',
    `short English runtime fragment must not enter the user Thinking panel: ${fragment}`
  );
}

assert.strictEqual(
  sanitizeUserVisibleThinkingText('The The place **预操作判断**：第二张商品图将放入对应卡片，之后检查主体清晰度。'),
  '预操作判断：第二张商品图将放入对应卡片，之后检查主体清晰度。',
  'known English narration prefix should be removed while preserving the Chinese design judgment'
);

for (const narration of [
  '我需要使用 searchProjectResources 搜索蓝色文件。',
  '第一个矩形创建成功。现在创建第二个卡片背景。'
]) {
  assert.strictEqual(
    sanitizeUserVisibleThinkingText(narration),
    '',
    `mechanical operation narration must not enter the user Thinking panel: ${narration}`
  );
}

assert.strictEqual(
  formatAssistantFailureContent({
    message: '当前还缺少关键信息；本轮不会改动画面。',
    successfulMutationCalls: 3,
    prefix: ''
  }),
  '当前版本已产生 3 次画面或文件改动，但后续处理没有完成；请先复核现有结果。',
  'failure copy must not claim the canvas was untouched when execution results contain successful mutations'
);

assert.strictEqual(
  finalizeUserVisibleThinkingText('看来能力已经装载，不需要额外请求。当前'),
  '看来能力已经装载，不需要额外请求。',
  'Persisted thinking must drop a trailing incomplete sentence fragment'
);

const focusedSkuCapabilityAnswer = sanitizeUserVisibleAssistantBodyText(
  '会做。SKU 我会围绕组合图和对应自选备注来处理；真正执行时再读取项目素材和配置。'
);
assert.strictEqual(
  focusedSkuCapabilityAnswer,
  '',
  'SKU capability answer that drifts into execution-process promises must be suppressed before final repair'
);

const staleFixedSkuCapabilityFallback = sanitizeUserVisibleAssistantBodyText(
  '会做。SKU 主要包括组合图、规格备注和自选备注。'
);
assert.strictEqual(
  staleFixedSkuCapabilityFallback,
  '',
  'old local fixed SKU capability fallback must be suppressed after fallback removal'
);

const cleanFocusedSkuCapabilityAnswer = sanitizeUserVisibleAssistantBodyText(
  '能做，SKU 这块我会按组合图和自选备注来理解。'
);
assert.strictEqual(
  cleanFocusedSkuCapabilityAnswer,
  '能做，SKU 这块我会按组合图和自选备注来理解。',
  'natural focused SKU capability answer should remain visible when it only answers the capability boundary'
);

const staleAuthFailureText = sanitizeUserVisibleAssistantBodyText(
  '当前对话模型鉴权失败，无法生成自然回复。请在设置里检查当前模型的 API Key；本次没有执行 Photoshop 操作。'
);
assert(
  staleAuthFailureText.includes('API Key') &&
    !staleAuthFailureText.includes('现在没能生成有效回复') &&
    staleAuthFailureText.includes('API Key') &&
    !staleAuthFailureText.includes('没有收到模型回复') &&
    !staleAuthFailureText.includes('Photoshop') &&
    !staleAuthFailureText.includes('切换一个可用模型') &&
    !staleAuthFailureText.includes('AI 对话服务') &&
    !staleAuthFailureText.includes('鉴权失败') &&
    !staleAuthFailureText.includes('认证失败') &&
    !staleAuthFailureText.includes('重新填写'),
  'stale persisted auth-failure copy must be softened when old conversations reload'
);
const staleUnavailableFailureText = sanitizeUserVisibleAssistantBodyText(
  '⚠️ 对话模型没有返回有效内容，本次不会改动 Photoshop 文档。 对话模型没有返回有效内容，我会重新组织可读回复。'
);
assert(
  staleUnavailableFailureText.includes(MODEL_UNAVAILABLE_COPY) &&
    !staleUnavailableFailureText.includes('现在没能生成有效回复') &&
    !staleUnavailableFailureText.includes('没有收到模型回复') &&
    !staleUnavailableFailureText.includes('Photoshop') &&
    !staleUnavailableFailureText.includes('对话模型没有返回有效内容') &&
    !staleUnavailableFailureText.includes('重新组织可读回复'),
  'stale persisted unavailable-model copy must not keep developer fallback wording'
);
const standaloneConversationalUnavailableText = sanitizeUserVisibleDiagnosticText(
  'Conversational reply unavailable'
);
assert(
  standaloneConversationalUnavailableText.includes(MODEL_UNAVAILABLE_COPY) &&
    !standaloneConversationalUnavailableText.includes('现在没能生成有效回复') &&
    !standaloneConversationalUnavailableText.includes('没有收到模型回复') &&
    !standaloneConversationalUnavailableText.includes('Photoshop') &&
    !standaloneConversationalUnavailableText.includes('认证失败') &&
    !standaloneConversationalUnavailableText.includes('API Key'),
  'standalone conversational-unavailable status must be neutral and avoid old model-fallback copy'
);
const formattedStandaloneConversationalUnavailableText = formatAssistantFailureContent({
  message: '暂时没有拿到可靠回复；本轮不会改动画面。可以稍后再试，或在设置里切换可用的回复服务。',
  error: 'Conversational reply unavailable'
});
assert(
  formattedStandaloneConversationalUnavailableText.includes(MODEL_UNAVAILABLE_COPY) &&
    !formattedStandaloneConversationalUnavailableText.includes('现在没能生成有效回复') &&
    !formattedStandaloneConversationalUnavailableText.includes('没有收到模型回复') &&
    !formattedStandaloneConversationalUnavailableText.includes('Photoshop') &&
    !formattedStandaloneConversationalUnavailableText.includes('本轮不会改动画面') &&
    !formattedStandaloneConversationalUnavailableText.includes('认证失败') &&
    !formattedStandaloneConversationalUnavailableText.includes('API Key'),
  'formatted conversational-unavailable status must keep neutral service-status copy'
);

const formattedFontLayoutReviewText = formatAssistantFailureContent({
  message: '字体已写入，但文本边界变化明显，需要复核或继续调整排版后才能算完成。标题的文字占位发生明显变化；需要检查是否挤压相邻元素、超出安全留白或破坏标题层级。',
  error: 'font replacement needs layout review'
});
assert(
  formattedFontLayoutReviewText.includes('字体已写入') &&
    formattedFontLayoutReviewText.includes('挤压相邻元素') &&
    !formattedFontLayoutReviewText.includes('font replacement needs layout review') &&
    !formattedFontLayoutReviewText.includes('错误:'),
  'font layout review should remain user-facing and must not leak internal execution code'
);

const formattedFontMetricDriftText = formatAssistantFailureContent({
  message: '字体已写入，但版面复核发现字号、字距或行距发生非预期变化；1/1 个文本图层通过字体验证。',
  error: 'font replacement changed typography metrics'
});
assert(
  formattedFontMetricDriftText.includes('字号、字距或行距') &&
    !formattedFontMetricDriftText.includes('font replacement changed typography metrics') &&
    !formattedFontMetricDriftText.includes('错误:'),
  'font metric drift should not expose internal execution code'
);

const staleEmptyConversationalFallbackText = sanitizeUserVisibleAssistantBodyText(
  '当前没有生成可展示回复，我先不动 Photoshop。 错误: 当前还缺少关键信息，我先不动你的画面。'
);
assert(
  staleEmptyConversationalFallbackText.includes(MODEL_UNAVAILABLE_COPY) &&
    !staleEmptyConversationalFallbackText.includes('现在没能生成有效回复') &&
    !staleEmptyConversationalFallbackText.includes('没有收到模型回复') &&
    !staleEmptyConversationalFallbackText.includes('Photoshop') &&
    !staleEmptyConversationalFallbackText.includes('当前没有生成可展示回复') &&
    !staleEmptyConversationalFallbackText.includes('缺少关键信息'),
  'stale empty conversational fallback must migrate to model-unavailable copy instead of blocked-status wording'
);
const staleGenericUnavailableText = sanitizeUserVisibleAssistantBodyText(
  '我这边暂时无法生成自然回复，先不改动画面；请在设置里检查模型连接或切换可用模型。'
);
assert(
  staleGenericUnavailableText.includes(MODEL_UNAVAILABLE_COPY) &&
    !staleGenericUnavailableText.includes('现在没能生成有效回复') &&
    !staleGenericUnavailableText.includes('没有收到模型回复') &&
    !staleGenericUnavailableText.includes('Photoshop') &&
    !staleGenericUnavailableText.includes('暂时无法生成自然回复'),
  'stale generic unavailable-model copy must migrate to the shared user-facing message'
);
const staleFakeCapabilityFallbackText = sanitizeUserVisibleAssistantBodyText(
  '可以做 SKU。当前对话模型连接不可用，所以这里只做最低限度确认；本轮不会因为这个问句改动 Photoshop。请在设置里检查模型连接或切换可用模型。'
);
assert(
  staleFakeCapabilityFallbackText.includes(MODEL_UNAVAILABLE_COPY) &&
    !staleFakeCapabilityFallbackText.includes('现在没能生成有效回复') &&
    !staleFakeCapabilityFallbackText.includes('没有收到模型回复') &&
    !staleFakeCapabilityFallbackText.includes('Photoshop') &&
    !staleFakeCapabilityFallbackText.includes('能力问题') &&
    !staleFakeCapabilityFallbackText.includes('可以做 SKU') &&
    !staleFakeCapabilityFallbackText.includes('AI 对话服务') &&
    !staleFakeCapabilityFallbackText.includes('当前对话模型连接不可用') &&
    !staleFakeCapabilityFallbackText.includes('最低限度确认') &&
    !staleFakeCapabilityFallbackText.includes('组合图') &&
    !staleFakeCapabilityFallbackText.includes('自选备注'),
  'stale fake capability fallback must be rewritten to model-unavailable copy without capability claims'
);
const staleResponsibleModelFallbackText = sanitizeUserVisibleAssistantBodyText(
  '我现在接不上负责自然对话的模型，不能可靠回答这个能力问题；这次先不改 Photoshop。请在设置里检查模型连接或切换可用模型。'
);
assert(
  staleResponsibleModelFallbackText.includes(MODEL_UNAVAILABLE_COPY) &&
    !staleResponsibleModelFallbackText.includes('现在没能生成有效回复') &&
    !staleResponsibleModelFallbackText.includes('没有收到模型回复') &&
    !staleResponsibleModelFallbackText.includes('Photoshop') &&
    !staleResponsibleModelFallbackText.includes('能力问题') &&
    !staleResponsibleModelFallbackText.includes('AI 对话服务') &&
    !staleResponsibleModelFallbackText.includes('负责自然对话的模型'),
  'stale responsible-model capability fallback must migrate to the shared user-facing message'
);
const staleAiServiceFallbackText = sanitizeUserVisibleAssistantBodyText(
  '我现在接不上 AI 对话服务，不能可靠回答这个能力问题；这次先不改动画面。请在设置里检查 AI 连接或切换可用模型。'
);
assert(
  staleAiServiceFallbackText.includes(MODEL_UNAVAILABLE_COPY) &&
    !staleAiServiceFallbackText.includes('现在没能生成有效回复') &&
    !staleAiServiceFallbackText.includes('没有收到模型回复') &&
    !staleAiServiceFallbackText.includes('Photoshop') &&
    !staleAiServiceFallbackText.includes('能力问题') &&
    !staleAiServiceFallbackText.includes('切换一个可用模型') &&
    !staleAiServiceFallbackText.includes('AI 对话服务') &&
    !staleAiServiceFallbackText.includes('AI 连接') &&
    !staleAiServiceFallbackText.includes('不能可靠回答这个能力问题'),
  'stale AI-service capability fallback must migrate during visible message rendering'
);

const dedupedCapabilityUnavailableFailure = formatAssistantFailureContent({
  message: '暂时没有拿到可靠回复能力问题；本轮不会改动画面。可以稍后再试，或在设置里切换可用的回复服务。',
  error: 'Conversational reply unavailable'
});
assert.strictEqual(
  (dedupedCapabilityUnavailableFailure.match(/这次没有拿到模型回复，先不继续处理。/g) || []).length,
  1,
  'capability unavailable warning must not append a duplicate generic unavailable detail'
);
assert(
  !dedupedCapabilityUnavailableFailure.includes('能力问题') &&
    !dedupedCapabilityUnavailableFailure.includes('暂时没拿到可靠回复') &&
    !dedupedCapabilityUnavailableFailure.includes('请在设置里检查当前模型'),
  'capability unavailable warning should use one neutral service-status copy and drop the generic duplicate'
);

const dedupedFocusedCapabilityUnavailableFailure = formatAssistantFailureContent({
  message: '暂时没有拿到稳定回复；我先不改动画面。可以稍后再试，或在设置里切换可用的回复服务。',
  error: 'Conversational reply unavailable'
});
assert.strictEqual(
  (dedupedFocusedCapabilityUnavailableFailure.match(/这次没有拿到模型回复，先不继续处理。/g) || []).length,
  1,
  'focused capability unavailable warning must not append a duplicate generic unavailable detail'
);
assert(
  !dedupedFocusedCapabilityUnavailableFailure.includes('API Key') &&
    !dedupedFocusedCapabilityUnavailableFailure.includes('认证失败'),
  'focused capability unavailable warning should stay neutral unless provider auth actually failed'
);

const dedupedGenericUnavailableBlockedFailure = formatAssistantFailureContent({
  message: '暂时没有拿到可靠回复；本轮不会改动画面。可以稍后再试，或在设置里切换可用的回复服务。',
  error: 'blocked_missing_context'
});
assert.strictEqual(
  (dedupedGenericUnavailableBlockedFailure.match(/这次没有拿到模型回复，先不继续处理。/g) || []).length,
  1,
  'generic unavailable warning must not append a duplicate blocked-state detail'
);
assert(
  !dedupedGenericUnavailableBlockedFailure.includes('当前还缺少关键信息') &&
    !dedupedGenericUnavailableBlockedFailure.includes('处理没有完成'),
  'generic unavailable warning should hide fallback blocked-state wording'
);
const staleWhiteBgDebugText = sanitizeUserVisibleAssistantBodyText([
  '准备处理设计任务',
  '白底图导出失败',
  '来源=[local-path-redacted] 输出=[local-path-redacted] 工具=exportWhiteBgFromSkuMaterial 读回=1/1',
  '错误: exportWhiteBgFromSkuMaterial 调用超时：疑似 Photoshop 原生弹窗或 UXP 模态状态阻塞。'
].join('\n'));
assert(
  staleWhiteBgDebugText.includes('白底图没有导出成功') &&
    staleWhiteBgDebugText.includes('弹窗或面板状态阻塞') &&
    !/来源=|输出=|工具=|读回=|exportWhiteBgFromSkuMaterial|local-path-redacted/.test(staleWhiteBgDebugText),
  'stale white-background export debug text must become a user-facing design task message'
);
const missingProjectImagesFailure = formatAssistantFailureContent({
  message: '当前项目里没有可分析的图片资源。',
  error: 'No project images available'
});
assert.strictEqual(
  (missingProjectImagesFailure.match(/当前项目里没有可分析的图片资源/g) || []).length,
  1,
  'project image missing failure should not duplicate the same visible message'
);
assert(
  !/No project images available|错误:/.test(missingProjectImagesFailure),
  'project image missing failure should not expose internal English error codes'
);
const planningGateFailure = formatAssistantFailureContent({
  message: '我需要先确定这次设计的方向、画面重点和效果检查方式，再开始改动画面。',
  error: 'agent_task_plan_requires_model_planning'
});
assert(
  planningGateFailure.includes('画面重点') &&
    planningGateFailure.includes('本轮不会直接改动画面') &&
    !planningGateFailure.includes('我需要先确定这次设计的方向') &&
    !planningGateFailure.includes('agent_task_plan_requires_model_planning') &&
    !planningGateFailure.includes('错误:'),
  'planning-gate failure should stay user-facing and must not expose raw error labels'
);
const designPreflightDecisionGateFailure = formatAssistantFailureContent({
  message: '这个任务需要先形成清晰的设计计划，再执行 Photoshop 写入。当前缺少模型或人工的设计决策。',
  error: 'needs_model_design_decision'
});
assert(
  designPreflightDecisionGateFailure.includes('画面重点') &&
    designPreflightDecisionGateFailure.includes('本轮不会直接改动画面') &&
    !designPreflightDecisionGateFailure.includes('Photoshop 写入') &&
    !designPreflightDecisionGateFailure.includes('模型或人工') &&
    !designPreflightDecisionGateFailure.includes('设计决策') &&
    !designPreflightDecisionGateFailure.includes('needs_model_design_decision') &&
    !designPreflightDecisionGateFailure.includes('错误:'),
  'design preflight blocker copy must not expose implementation wording or raw status'
);
const designPreflightVisualObservationFailure = formatAssistantFailureContent({
  message: '这个任务需要先确认项目视觉素材和设计方向，再执行 Photoshop 写入。当前缺少项目视觉素材理解。',
  error: 'needs_visual_observation'
});
assert(
  designPreflightVisualObservationFailure.includes('先确认项目视觉素材和设计方向') &&
    !designPreflightVisualObservationFailure.includes('Photoshop 写入') &&
    !designPreflightVisualObservationFailure.includes('视觉素材理解') &&
    !designPreflightVisualObservationFailure.includes('needs_visual_observation') &&
    !designPreflightVisualObservationFailure.includes('错误:'),
  'visual-observation preflight blocker copy must be product-facing rather than implementation-facing'
);
const executorTemplateMissingFailure = formatAssistantFailureContent({
  message: '处理失败',
  error: '项目模板目录缺少 2双模板'
});
assert(
  executorTemplateMissingFailure.includes('项目模板目录缺少 2双模板') &&
    !executorTemplateMissingFailure.includes('错误:') &&
    !/executor|skill|tool_call_failed|blocked_/i.test(executorTemplateMissingFailure),
  'executor template blockers should keep the actionable template detail without raw error labeling'
);
const staleStateCardText = sanitizeUserVisibleDiagnosticText(
  '先完成任务计划、上下文读取和结果检查标准，再按确认后的方案处理。'
);
assert(
  staleStateCardText.includes('结果检查方式') &&
    !staleStateCardText.includes('结果检查标准') &&
    !staleStateCardText.includes('检查标准'),
  'stale state cards must not keep internal inspection-standard wording'
);
const uxpDisconnectedBridgeError = "**工具错误：** Error invoking remote method 'ws:send': Error: UXP 插件未连接 错误: Error invoking remote method 'ws:send': Error: UXP 插件未连接";
const cleanedUxpDisconnectedBridgeError = sanitizeUserVisibleDiagnosticText(uxpDisconnectedBridgeError);
assert(
  /Photoshop|插件|面板|PS/.test(cleanedUxpDisconnectedBridgeError) &&
    /打开|连接|重试|再试/.test(cleanedUxpDisconnectedBridgeError),
  'UXP bridge disconnection errors should become a recoverable user-facing Photoshop connection hint'
);
assert(
  !/Error invoking|ws:send|工具错误|remote method/.test(cleanedUxpDisconnectedBridgeError),
  'UXP bridge disconnection diagnostics must not expose internal bridge method names'
);
const formattedUxpDisconnectedBridgeFailure = formatAssistantFailureContent({
  message: '无法获取 Photoshop 文档列表',
  error: uxpDisconnectedBridgeError
});
assert(
  /Photoshop|插件|面板|PS/.test(formattedUxpDisconnectedBridgeFailure) &&
    !/Error invoking|ws:send|工具错误|remote method/.test(formattedUxpDisconnectedBridgeFailure),
  'assistant failure formatting must not reintroduce raw UXP bridge errors'
);
const formattedSkuDocumentReadFailure = formatAssistantFailureContent({
  message: '当前还不能读取已打开的设计文档，因此暂时不能继续处理 SKU。',
  error: uxpDisconnectedBridgeError
});
assert(
  /插件|面板|PS/.test(formattedSkuDocumentReadFailure) &&
    !/UXP|文档列表|listDocuments|remote method|ws:send|工具错误/i.test(formattedSkuDocumentReadFailure),
  'SKU document-read blockers should show one actionable plugin connection hint without UXP/listDocuments internals'
);
assert(
  (formattedSkuDocumentReadFailure.match(/Photoshop/g) || []).length <= 1,
  'SKU document-read blockers should not repeat Photoshop connection wording in the same visible message'
);
const staleOpenDesignClarificationText = sanitizeUserVisibleAssistantBodyText(
  '这个请求属于开放式设计执行，但当前缺少模型明确放行或足够路由信息。需要先明确设计目标、允许修改的范围，以及是否基于当前 Photoshop 文档执行。'
);
assert(
  staleOpenDesignClarificationText.includes('开放式设计需要先确认重点') &&
    !staleOpenDesignClarificationText.includes('我需要先确认这次设计') &&
    !staleOpenDesignClarificationText.includes('开放式设计执行') &&
    !staleOpenDesignClarificationText.includes('模型明确放行') &&
    !staleOpenDesignClarificationText.includes('路由信息'),
  'stale autonomous clarification text must be rewritten to designer-facing copy'
);
assert(
  appStoreSource.includes('sanitizeUserVisibleAssistantBodyText') &&
    /role\s*===\s*['"]assistant['"][\s\S]{0,260}sanitizeUserVisibleAssistantBodyText/.test(appStoreSource),
  'assistant messages must be sanitized before store persistence so hidden canned replies cannot survive reloads'
);
assert(
  appStoreSource.includes('sanitizeMessageForPersistence({') &&
    appStoreSource.includes('...newMessages[newMessages.length - 1]') &&
    appStoreSource.includes('...m, ...updates') &&
    appStoreSource.includes('content: newContent'),
  'assistant message updates must sanitize the merged full message, not only partial updates without role'
);
assert(
  appStoreSource.includes('? sanitizeConversationsForPersistence(result.conversations)') &&
    appStoreSource.includes('const loadedMemoryConversations = sanitizeConversationsForPersistence(memConvs)') &&
    /function mergeConversationCollections[\s\S]{0,500}return sanitizeConversationsForPersistence/.test(appStoreSource),
  'assistant messages must also be sanitized when persisted conversations are loaded back into UI state'
);
assert(
  appStoreSource.includes('function shouldKeepSanitizedMessage') &&
    appStoreSource.includes('.filter(shouldKeepSanitizedMessage)') &&
    !/function hasMeaningfulAssistantPayload[\s\S]{0,500}message\.agentRequestLifecycle(?![A-Za-z])/.test(appStoreSource) &&
    !/function hasMeaningfulAssistantPayload[\s\S]{0,500}message\.agentDiagnosticRecord(?![A-Za-z])/.test(appStoreSource) &&
    !/function hasMeaningfulAssistantPayload[\s\S]{0,500}message\.agentTaskPlan(?![A-Za-z])/.test(appStoreSource),
  'empty assistant messages produced by cleaning stale canned replies must be pruned from persisted conversation history'
);
assert(
  !conversationalSource.includes('function buildLocalTaskSummaryReply') &&
    !conversationalSource.includes('function buildLocalContinuationReply') &&
    !conversationalSource.includes('当前只能基于最近对话做简要回顾') &&
    !conversationalSource.includes('我理解你想继续上一轮上下文'),
  'local conversational fallbacks must not fabricate task summary or continuation assistant speech'
);

const diagnosticJson = sanitizeUserVisibleAgentText(JSON.stringify({
  agentDiagnosticRecord: {
    recordKeys: ['agentIntentDeliberationGate'],
    rawPayloadRedacted: true
  },
  toolCalls: [{ name: 'skuLayout' }]
}));
assert.strictEqual(diagnosticJson, '', 'structured diagnostic record JSON must not become visible chat text');

const diagnosticOnlyJson = sanitizeUserVisibleAgentText(JSON.stringify({
  recordKeys: ['agentIntentDeliberationGate'],
  rawPayloadRedacted: true,
  agentIntentDeliberationGate: {
    status: 'deterministic_route_used',
    modelConsulted: false
  }
}));
assert.strictEqual(diagnosticOnlyJson, '', 'diagnostic-only JSON without route/toolCalls must not become visible chat text');

const diagnosticMessageJson = sanitizeUserVisibleAgentText(JSON.stringify({
  message: 'agentDiagnosticRecord rawPayloadRedacted recordKeys agentTaskPlan',
  agentDiagnosticRecord: {
    recordKeys: ['agentIntentDeliberationGate'],
    rawPayloadRedacted: true
  }
}));
assert.strictEqual(diagnosticMessageJson, '', 'diagnostic JSON with a message field must not project developer diagnostics to chat');

const taskPlanJson = sanitizeUserVisibleAgentText(JSON.stringify({
  agentTaskPlan: {
    status: 'ready_direct_response',
    route: 'direct_response',
    userVisibleState: {
      summary: '这是对话或规划讨论，本轮不调用 Photoshop 工具。'
    }
  },
  recordKeys: ['agentTaskPlan']
}));
assert.strictEqual(taskPlanJson, '', 'agent task-plan payloads must not leak as visible chat text');

const internalAssetAgentText = sanitizeUserVisibleAgentText(
  '素材判断：assetNature=raw_photo，role=raw-model-wear；不要使用 finished_design，当作 raw-product-still 处理。'
);
assertNoInternalAssetVocabulary(internalAssetAgentText, 'agent visible text must not expose internal asset role vocabulary');
assert(
  internalAssetAgentText.includes('项目原片') &&
    internalAssetAgentText.includes('模特实拍图') &&
    internalAssetAgentText.includes('成品设计图') &&
    internalAssetAgentText.includes('产品实拍图'),
  'internal asset role vocabulary should be rewritten into user-facing material descriptions'
);

const internalAssetThinkingText = sanitizeUserVisibleThinkingText(
  '我先筛出 raw-detail-closeup 和 color-single，再避开 finished_design。'
);
assertNoInternalAssetVocabulary(internalAssetThinkingText, 'visible thinking text must not expose internal asset role vocabulary');
assert(
  internalAssetThinkingText.includes('细节实拍图') &&
    internalAssetThinkingText.includes('单色款式图') &&
    internalAssetThinkingText.includes('成品设计图'),
  'visible thinking text should rewrite internal asset roles without hiding the useful intent'
);

const directResponse = cleanAssistantResponseContent(JSON.stringify({
  route: 'direct_response',
  directResponse: '这是自然语言回复。'
}));
assert.strictEqual(directResponse, '这是自然语言回复。', 'structured directResponse should unwrap');

const clarification = cleanAssistantResponseContent('```json\n{"route":"clarification_needed","clarificationQuestion":"要处理哪一个文档？"}\n```');
assert.strictEqual(clarification, '要处理哪一个文档？', 'structured clarification should unwrap');

const unavailableFailure = cleanAssistantFailureErrorText('Conversational reply unavailable');
assert(!unavailableFailure.includes('Conversational reply unavailable'), 'conversational fallback error must not leak');
assert(
  unavailableFailure.includes(MODEL_UNAVAILABLE_COPY) &&
    !unavailableFailure.includes('现在没能生成有效回复') &&
    !unavailableFailure.includes('没有收到模型回复'),
  'conversational unavailable status should be user-readable without old fallback copy'
);
assert(!unavailableFailure.includes('重新组织可读回复'), 'conversational fallback must not promise a local readable reply rewrite');

const designDecisionFailure = cleanAssistantFailureErrorText('needs_model_design_decision');
assert(!designDecisionFailure.includes('needs_model_design_decision'), 'design preflight status must not leak as raw error');
assert(designDecisionFailure.includes('画面重点'), 'design preflight failure should be user-readable');

const skillDisabledFailure = cleanAssistantFailureErrorText('Skill disabled');
assert(!skillDisabledFailure.includes('Skill disabled'), 'skill disabled must not leak as raw error');
assert(skillDisabledFailure.includes('暂时还不能直接完成'), 'skill disabled failure should be user-readable');

const unknownStatusFailure = cleanAssistantFailureErrorText('blocked_missing_readback_targets');
assert(!unknownStatusFailure.includes('blocked_missing_readback_targets'), 'unknown internal status code must not leak');
assert(unknownStatusFailure.includes('缺少关键信息'), 'unknown internal status code should produce a user-readable blocked message');

for (const diagnosticOnlyCode of ['delivery_action_missing', 'runtime_stage_incomplete']) {
  assert.strictEqual(
    cleanAssistantFailureErrorText(diagnosticOnlyCode),
    '',
    `${diagnosticOnlyCode} must remain diagnostic-only instead of being presented as missing user input`
  );
  const diagnosticOnlyFailure = formatAssistantFailureContent({
    message: '已经完成现状读取，但尚未执行任务要求的实际修改。',
    error: diagnosticOnlyCode
  });
  assert(
    diagnosticOnlyFailure.includes('已经完成现状读取'),
    `${diagnosticOnlyCode} should preserve the concrete primary result`
  );
  assert(
    !diagnosticOnlyFailure.includes(diagnosticOnlyCode),
    `${diagnosticOnlyCode} must not leak into the user-visible result`
  );
  assert(
    !/(当前还缺少关键信息|当前条件还不够完整|本轮不会改动画面)/.test(diagnosticOnlyFailure),
    `${diagnosticOnlyCode} must not be misrepresented as missing user input`
  );
}

const messageFailure = cleanAssistantFailureMessageText('Skill executor not found');
assert(!messageFailure.includes('Skill executor not found'), 'internal failure message must not leak');
assert(messageFailure.includes('暂时还不能直接完成'), 'internal failure message should be mapped');

const combinedDesignFailure = formatAssistantFailureContent({
  message: '这个任务需要先形成清晰的设计方案，再进入处理流程。当前缺少模型或人工的设计决策。',
  error: 'needs_model_design_decision'
});
assert(!combinedDesignFailure.includes('needs_model_design_decision'), 'combined failure must not leak raw design decision status');
assert(!combinedDesignFailure.includes('错误:'), 'combined internal failure should not show a raw error label');
assert.strictEqual(
  combinedDesignFailure.split('这个任务需要先形成清晰的设计方案').length - 1,
  1,
  'combined internal failure should not duplicate equivalent failure copy'
);

const contextualSourceBusinessFailure = formatAssistantFailureContent({
  message: '当前条件还不完整，本轮不改动文档。',
  error: 'business_visual_observation_required_before_execution',
  businessVisualObservationFeedback: {
    userVisible: true,
    severity: 'warning',
    title: '候选素材需要视觉确认',
    summary: '已找到候选素材，但还缺少可用的视觉理解结果。；候选 0/0；可用素材源 4；待分析 0；缓存命中 0；有效洞察 0',
    actionHint: '可以继续使用已明确的素材源；涉及款式、卖点或审美判断前，需要视觉分析或人工确认。',
    recommendedActions: ['offer_visual_analysis', 'avoid_semantic_claims'],
    preflightStrategy: {
      mode: 'observation-only',
      canProceed: true,
      shouldRefreshProjectContext: false,
      shouldAskUserToSelectImages: false,
      shouldOfferVisualAnalysis: true,
      shouldAvoidSemanticClaims: true
    },
    warningItems: ['已有候选素材但缺少视觉洞察；应显式 opt-in 调用视觉模型或等待人工确认。'],
    blockerItems: []
  }
});
assert(
  !contextualSourceBusinessFailure.includes('当前条件还不完整'),
  'contextual-source business failures must not collapse into generic incomplete-condition copy'
);
assert(
  contextualSourceBusinessFailure.includes('候选素材') || contextualSourceBusinessFailure.includes('可用素材源'),
  'contextual-source business failures should tell the user that usable source material was found'
);
assert(
  !contextualSourceBusinessFailure.includes('business_visual_observation_required_before_execution'),
  'contextual-source business failures must not expose internal visual observation status'
);

const hiddenContextualSourceBusinessFailure = formatAssistantFailureContent({
  message: '当前条件还不完整，本轮不改动文档。',
  error: 'business_visual_observation_required_before_execution',
  businessVisualObservationFeedback: {
    userVisible: false,
    severity: 'warning',
    title: '候选素材需要视觉确认',
    summary: '已找到候选素材，但还缺少可用的视觉理解结果。；候选 0/0；可用素材源 4；待分析 0；缓存命中 0；有效洞察 0',
    actionHint: '可以继续使用已明确的素材源；涉及款式、卖点或审美判断前，需要视觉分析或人工确认。',
    recommendedActions: ['offer_visual_analysis', 'avoid_semantic_claims'],
    preflightStrategy: {
      mode: 'observation-only',
      canProceed: true,
      shouldRefreshProjectContext: false,
      shouldAskUserToSelectImages: false,
      shouldOfferVisualAnalysis: true,
      shouldAvoidSemanticClaims: true
    },
    warningItems: [],
    blockerItems: []
  }
});
assert(
  hiddenContextualSourceBusinessFailure.includes('候选素材') || hiddenContextualSourceBusinessFailure.includes('可用素材源'),
  'hidden non-blocking feedback should still inform assistant failure copy'
);
assert(
  !hiddenContextualSourceBusinessFailure.includes('当前条件还不完整'),
  'hidden non-blocking feedback must not fall back to generic incomplete-condition copy'
);

const specificSkuFailureWithBusinessFeedback = formatAssistantFailureContent({
  message: [
    'SKU 暂时没有开始生成：项目配置「6色 2-3-4.csv」和素材「SKU.psb」还没有对齐。',
    '',
    '当前需要先处理：',
    '- SKU 素材只有 5 个可用颜色组，配置文件需要 6 个颜色槽。'
  ].join('\n'),
  error: 'SKU 素材只有 5 个可用颜色组，配置文件需要 6 个颜色槽。',
  businessVisualObservationFeedback: {
    userVisible: false,
    severity: 'warning',
    title: '候选素材需要视觉确认',
    summary: '已找到候选素材，但还缺少可用的视觉理解结果。；候选 0/0；可用素材源 1；待分析 0；缓存命中 0；有效洞察 0',
    actionHint: '可以继续使用已明确的素材源；涉及款式、卖点或审美判断前，需要视觉分析或人工确认。',
    recommendedActions: ['offer_visual_analysis', 'avoid_semantic_claims'],
    preflightStrategy: {
      mode: 'observation-only',
      canProceed: true,
      shouldRefreshProjectContext: false,
      shouldAskUserToSelectImages: false,
      shouldOfferVisualAnalysis: true,
      shouldAvoidSemanticClaims: true
    },
    warningItems: [],
    blockerItems: []
  }
});
assert(
  specificSkuFailureWithBusinessFeedback.includes('SKU 暂时没有开始生成'),
  'specific SKU execution failures should not be overwritten by generic visual-observation feedback'
);
assert(
  specificSkuFailureWithBusinessFeedback.includes('SKU 素材只有 5 个可用颜色组'),
  'specific SKU execution failures should preserve the actionable blocker'
);
assert(
  !specificSkuFailureWithBusinessFeedback.includes('错误:') &&
  !specificSkuFailureWithBusinessFeedback.includes('错误：'),
  'specific SKU execution failures should not append a raw error label'
);
assert(
  !specificSkuFailureWithBusinessFeedback.includes('缺少能支撑款式'),
  'specific SKU execution failures should not be replaced by visual-analysis copy'
);

const missingSkuColorGroupsFailure = formatAssistantFailureContent({
  message: [
    'SKU 素材「SKU.psb」没有识别到可用颜色图层组，暂时不能生成 SKU。',
    '',
    '当前识别到的图层组：参考组、All_Grouped_1780536108577。',
    '请确认项目 PSD/SKU.psb 中存在以颜色命名的袜子图层组，或重新加载最新版 UXP 插件后再试。'
  ].join('\n'),
  error: [
    'SKU 素材「SKU.psb」没有识别到可用颜色图层组，暂时不能生成 SKU。',
    '',
    '当前识别到的图层组：参考组、All_Grouped_1780536108577。',
    '请确认项目 PSD/SKU.psb 中存在以颜色命名的袜子图层组，或重新加载最新版 UXP 插件后再试。'
  ].join('\n')
});
assert(
  missingSkuColorGroupsFailure.includes('没有识别到可用颜色图层组'),
  'missing SKU color groups should remain actionable'
);
assert(
  !/No valid color layer groups|错误[:：]/.test(missingSkuColorGroupsFailure),
  'missing SKU color groups should not expose English diagnostics or raw error labels'
);

const genericSuccessBusinessFeedback = formatAssistantBusinessVisualFeedbackContent({
  message: '当前条件还不完整，本轮不改动文档。',
  businessVisualObservationFeedback: {
    userVisible: false,
    severity: 'warning',
    title: '候选素材需要视觉确认',
    summary: '已找到候选素材，但还缺少可用的视觉理解结果。；候选 0/0；可用素材源 4；待分析 0；缓存命中 0；有效洞察 0',
    actionHint: '可以继续使用已明确的素材源；涉及款式、卖点或审美判断前，需要视觉分析或人工确认。',
    recommendedActions: ['offer_visual_analysis', 'avoid_semantic_claims'],
    preflightStrategy: {
      mode: 'observation-only',
      canProceed: true,
      shouldRefreshProjectContext: false,
      shouldAskUserToSelectImages: false,
      shouldOfferVisualAnalysis: true,
      shouldAvoidSemanticClaims: true
    },
    warningItems: [],
    blockerItems: []
  }
});
assert(
  genericSuccessBusinessFeedback.includes('可用素材源') || genericSuccessBusinessFeedback.includes('候选素材'),
  'generic non-failure replies with business visual feedback should be replaced by specific user copy'
);
assert(
  !genericSuccessBusinessFeedback.includes('当前条件还不完整'),
  'generic non-failure replies with business visual feedback must not leak incomplete-condition copy'
);

const naturalSuccessBusinessFeedback = formatAssistantBusinessVisualFeedbackContent({
  message: '已完成白底图导出。',
  businessVisualObservationFeedback: {
    userVisible: false,
    severity: 'warning',
    title: '候选素材需要视觉确认',
    summary: '可用素材源 4',
    actionHint: '可以继续使用已明确的素材源。',
    recommendedActions: [],
    preflightStrategy: {
      mode: 'observation-only',
      canProceed: true,
      shouldRefreshProjectContext: false,
      shouldAskUserToSelectImages: false,
      shouldOfferVisualAnalysis: true,
      shouldAvoidSemanticClaims: true
    },
    warningItems: [],
    blockerItems: []
  }
});
assert.strictEqual(
  naturalSuccessBusinessFeedback,
  '',
  'specific completed replies should not be overwritten by business visual feedback'
);

const diagnosticStatus = sanitizeUserVisibleDiagnosticText('tool_call_failed:blocked_missing_readback_targets');
assert(!diagnosticStatus.includes('tool_call_failed'), 'diagnostic internal status prefix must not leak');
assert(!diagnosticStatus.includes('blocked_missing_readback_targets'), 'diagnostic status code must not leak');
assert(diagnosticStatus.includes('处理没有完成'), 'diagnostic status should be mapped to actionable safe copy');

const directStatusBody = sanitizeUserVisibleAssistantBodyText('direct_response');
assert(!directStatusBody.includes('direct_response'), 'assistant body must not expose direct_response as plain text');
assert.strictEqual(directStatusBody, '', 'assistant body internal route status should not be converted into fixed natural speech');

const clarificationStatusBody = sanitizeUserVisibleAssistantBodyText('clarification_needed');
assert(!clarificationStatusBody.includes('clarification_needed'), 'assistant body must not expose clarification_needed as plain text');
assert.strictEqual(clarificationStatusBody, '', 'assistant body clarification route status should not be converted into fixed natural speech');

const visualObservationStatusBody = sanitizeUserVisibleAssistantBodyText('needs_visual_observation');
assert(!visualObservationStatusBody.includes('needs_visual_observation'), 'assistant body must not expose visual-observation status code');
assert(
  visualObservationStatusBody.includes('视觉素材') || visualObservationStatusBody.includes('素材'),
  'assistant body should map visual-observation blocker status into user-facing copy'
);

const directStatusExplanation = sanitizeUserVisibleAssistantBodyText(
  'direct_response 是内部路由状态，意思是这轮只回答问题，不执行 Photoshop。'
);
assert(
  directStatusExplanation.includes('内部路由状态') &&
    directStatusExplanation.includes('不执行 Photoshop') &&
    !directStatusExplanation.includes('先和你确认想法'),
  'natural explanatory text that mentions direct_response must not collapse into a fixed status template'
);

const clarificationStatusExplanation = sanitizeUserVisibleAssistantBodyText(
  'clarification_needed 是内部路由状态，表示需要先问清一个关键问题。'
);
assert(
  clarificationStatusExplanation.includes('内部路由状态') &&
    clarificationStatusExplanation.includes('关键问题') &&
    !clarificationStatusExplanation.includes('需要先补充或确认目标'),
  'natural explanatory text that mentions clarification_needed must not collapse into a fixed status template'
);

const blockedStatusBody = sanitizeUserVisibleAssistantBodyText('blocked_missing_readback_targets');
assert(!blockedStatusBody.includes('blocked_missing_readback_targets'), 'assistant body must not expose blocked status codes');
assert.strictEqual(blockedStatusBody, '', 'assistant body blocked status should not be converted into fixed natural speech');

const blockedStatusWithPathBody = sanitizeUserVisibleAssistantBodyText('blocked_missing_readback_targets C:\\DesignEcho\\private\\SKU.psb');
assert(!blockedStatusWithPathBody.includes('blocked_missing_readback_targets'), 'assistant body must map blocked status even when a local path follows it');
assert(!blockedStatusWithPathBody.includes('C:\\UXP'), 'assistant body must redact local paths after blocked status codes');
assert(blockedStatusWithPathBody.includes('[local-path-redacted]'), 'assistant body should retain a redacted marker when status text carried a path');

const diagnosticPath = sanitizeUserVisibleDiagnosticText('写入失败: C:\\DesignEcho\\secret\\file.psd');
assert(!diagnosticPath.includes('C:\\UXP'), 'diagnostic local path must be redacted');
assert(diagnosticPath.includes('[local-path-redacted]'), 'diagnostic local path should be replaced with redaction marker');

const spacedDiagnosticPath = sanitizeUserVisibleDiagnosticText('写入失败: E:\\Script Project\\Dyin\\private file.psd');
assert(!spacedDiagnosticPath.includes('E:\\Script Project'), 'diagnostic local path with spaces must be redacted');
assert(!spacedDiagnosticPath.includes('private file.psd'), 'diagnostic local path redaction must cover the full path segment');
assert(spacedDiagnosticPath.includes('[local-path-redacted]'), 'diagnostic local path with spaces should be replaced with redaction marker');

console.log(JSON.stringify({
  success: true,
  checks: [
    'tool-call XML is removed from visible chat replies',
    'partial tool-call XML and router JSON are suppressed during streaming',
    'assistant persistence and local summaries cannot retain hidden canned capability replies',
    'formulaic SKU capability explainers are suppressed during streaming',
    'structured diagnostic records and task-plan JSON are hidden from visible chat',
    'natural conversational prefix is preserved',
    'structured direct and clarification replies still unwrap',
    'internal failure codes are converted to user-readable text',
    'combined assistant failures avoid duplicated internal status copy',
    'model-unavailable copy uses designer-facing language instead of AI service diagnostics',
    'specific SKU execution failures are not overwritten by generic visual-observation feedback',
    'successful assistant bodies cannot expose internal route/status codes',
    'diagnostic text redacts local paths and status codes',
    'diagnostic text redacts local paths that contain spaces'
  ]
}, null, 2));
