#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const agentRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(agentRoot, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function assertIncludes(content, needle, label) {
  if (!content.includes(needle)) {
    throw new Error(`${label} missing: ${needle}`);
  }
}

function assertNotIncludes(content, needle, label) {
  if (content.includes(needle)) {
    throw new Error(`${label} contains unexpected text: ${needle}`);
  }
}

const webview = read('DesignEcho-Agent/public/webview/index.html');
const textHandler = read('DesignEcho-Agent/src/main/uxp-handlers/text-handlers.ts');
const uxpBridge = read('DesignEcho-UXP/src/index.ts');
const copywritingFramework = read('DesignEcho-Agent/src/shared/design-copywriting-framework.ts');
const taskOrchestrator = read('DesignEcho-Agent/src/main/services/task-orchestrator.ts');
const webviewHandlers = read('DesignEcho-Agent/src/main/uxp-handlers/webview-handlers.ts');

for (const id of [
  'optimizeCreativeStyle',
  'optimizeTargetAudience',
  'optimizeLockedKeywords',
  'optimizeDescription',
  'optimizeImageSourceHint',
  'optimizeImageInput'
]) {
  assertIncludes(webview, id, 'copy optimization UI');
}

// 「使用当前画面」手动按钮已按用户要求移除；
// 生成时无参考图自动截取当前画面的默认行为保留（canvas-auto / captureOptimizeTextCanvasSnapshot）
assertNotIncludes(webview, 'optimizeUseCanvasBtn', 'manual canvas button removed');
assertNotIncludes(webview, 'optimizeTextUseCanvasSnapshot', 'manual canvas command removed from webview');
assertNotIncludes(uxpBridge, "case 'optimizeTextUseCanvasSnapshot'", 'manual canvas command removed from UXP bridge');

for (const removedUiToken of [
  '设计语境',
  '调整方向与边界',
  'optimizeContentType',
  'optimizeCopyRole',
  'optimizeForbiddenKeywords',
  'optimizeMaxChars',
  'optimizeRevisionNote',
  'optimizeFeedbackTags',
  'optimize-feedback-chip'
]) {
  assertNotIncludes(webview, removedUiToken, 'simplified copy optimization UI');
}

for (const fakeProgressToken of [
  '_optimizeGenSteps',
  '正在分析人群与商品信息',
  '正在生成三版候选文案',
  'AI 创作中，请稍候',
  '即将完成'
]) {
  assertNotIncludes(webview, fakeProgressToken, 'copywriting fake progress UI');
  assertNotIncludes(uxpBridge, fakeProgressToken, 'copywriting fake progress bridge');
}

for (const uiToken of [
  'optimize-candidate-card',
  'candidateDetails',
  'fitStatus',
  'optimize-candidate-badge'
]) {
  assertIncludes(webview, uiToken, 'copy optimization candidate card UI');
}

for (const key of [
  'creativeStyle',
  'targetAudience',
  'lockedKeywords',
  'description'
]) {
  assertIncludes(webview, key, 'webview payload');
  assertIncludes(uxpBridge, key, 'UXP optimize-text forwarding');
  assertIncludes(textHandler, key, 'Agent optimize-text handler');
}

for (const imageContextToken of [
  '默认自动使用当前画面',
  'optimizeTextImageCaptured',
  'applyOptimizeReferenceImage',
  'captureOptimizeTextCanvasSnapshot',
  'canvas-auto'
]) {
  assertIncludes(webview + '\n' + uxpBridge, imageContextToken, 'copywriting image context interaction');
}

for (const legacyKey of [
  'contentType',
  'copyRole',
  'forbiddenKeywords',
  'revisionNote',
  'goals',
  'maxChars'
]) {
  assertIncludes(uxpBridge, legacyKey, 'UXP optimize-text forwarding compatibility');
  assertIncludes(textHandler, legacyKey, 'Agent optimize-text handler compatibility');
}

for (const detailToken of [
  'buildCandidateDetail',
  'lengthDiff',
  'missingKeywords',
  'forbiddenHits',
  'fitLabel',
  'candidateMatchesLayoutSkeleton',
  'buildLayoutSkeletonDescription',
  'layoutSkeleton'
]) {
  assertIncludes(textHandler, detailToken, 'Agent candidate detail contract');
}

for (const promptText of [
  '文案撰写专家',
  '目标人群与兴趣方向',
  '版式骨架',
  '不包含当前文本语义',
  '不要围绕原文做同义改写',
  '内容场景',
  '文案角色',
  '本轮优化目标',
  '禁止出现的词',
  '用户对上一轮结果的具体反馈',
  '上下文完整性检查',
  '不得编造画面、功能、材质、场景或用户痛点'
]) {
  assertIncludes(textHandler, promptText, 'optimize prompt contract');
}

for (const removedPromptToken of [
  'lineTemplateDesc',
  '版式参考文本',
  '每行字数尽量接近',
  '默认只接受',
  '降级候选',
  '「${originalText}」',
  'getPreferredCharDiff',
  'fallbackCandidates',
  'mergeBestCandidates',
  '请补充商品简报、目标人群或参考图片后重试'
]) {
  assertNotIncludes(textHandler, removedPromptToken, 'strict layout prompt contract');
}

// 分档验收：近似候选降档展示而不是整条丢弃；重试要带上一轮失败样本
for (const tieredAcceptanceToken of [
  'WATCH_CHAR_TOLERANCE',
  'FIT_TIER_RANK',
  '版式全等方案',
  '近版式方案',
  '版式外方案',
  '上一轮失败样本',
  'previousFailures',
  'systemPromptOverride'
]) {
  assertIncludes(textHandler, tieredAcceptanceToken, 'tiered layout acceptance contract');
}

// 版式达标管线：分段输出（数段比数字数可靠）+ 确定性标点修复 + risk 档不凑数
// 断言到调用点/接线，不只钉函数定义（tsconfig 未开 noUnusedLocals，解线不会报警）
for (const complianceToken of [
  'stripCandidateSegmentation(String(item || \'\'), segmentationEnabled)',
  'repairCandidateToSkeleton(item, originalText)',
  'describeSkeletonMismatch(text, originalText)',
  '段与段之间用「｜」分隔',
  '不允许出现标点段',
  '模板例句自带标点',
  'usableCandidates.length > 0 ? usableCandidates : evaluated'
]) {
  assertIncludes(textHandler, complianceToken, 'skeleton compliance pipeline contract');
}

// 修复不损坏语义：数字/规格语义标点夹在字母数字间时保留（不把 9.9 改成 99）
for (const semanticGuardToken of [
  'stripDecorativePunctuation',
  'SEMANTIC_PUNCTUATION_PATTERN',
  'originalAllowsSegmentation',
  'SEGMENT_SEPARATOR_GLOBAL'
]) {
  assertIncludes(textHandler, semanticGuardToken, 'deterministic repair semantic guard contract');
}

// 分段格式仅在原文不含竖线时启用；括号类原文用宽口径判定不误说"无标点"
assertIncludes(textHandler, 'allowSegmentation', 'segmentation gated by original separators');
assertIncludes(textHandler, 'originalHasStructuralPunctuation', 'bracket-only original prompt uses wide punctuation detection');

// 重试失败样本取全部非全等候选（含被 risk 不凑数排除的），degraded 提示按实际形态精确
assertIncludes(textHandler, 'normalized.failureSamples', 'retry uses full failure samples not just picked');
assertIncludes(textHandler, 'degradedMessage', 'precise degraded message by candidate shape');
assertIncludes(uxpBridge, 'result?.degradedMessage', 'UXP uses precise degraded message');

// 编排器：调用方自带指令时不叠加默认提示词；不支持视觉的模型不发图并显式声明
for (const orchestratorToken of [
  'systemPromptOverride',
  '视觉证据不可用',
  'supportsVision === true',
  'getModelById'
]) {
  assertIncludes(taskOrchestrator, orchestratorToken, 'task orchestrator prompt/vision contract');
}

// UI：watch 档（小偏差）候选允许替换并提示核对版面，risk 档保持禁用
for (const watchTierUiToken of [
  "fitStatus !== 'risk'",
  '替换（建议核对版面）',
  '版式偏差'
]) {
  assertIncludes(webview, watchTierUiToken, 'watch tier candidate UI contract');
}

assertNotIncludes(uxpBridge, '已返回快速候选', 'UXP degraded toast accuracy');

// 参考图粘贴通道：面板内 Ctrl+V 直贴 + "读剪贴板"按钮兜底（经 Agent Electron 读系统剪贴板）
for (const pasteWebviewToken of [
  'optimizeClipboardBtn',
  'optimizeTextReadClipboardImage',
  // 撰写页粘贴监听的独有调用（imageToImage 页早有另一个 paste 监听，不能用 addEventListener('paste' 当锚点）
  "importOptimizeReferenceImageFile(file, 'paste')",
  '已使用粘贴的截图',
  '已使用剪贴板图片',
  'optimizeTextImageHintReset',
  'restoreOptimizeImageSourceHint',
  // 混合剪贴板守卫：焦点在输入框且剪贴板含文本时放行原生粘贴，不劫持成参考图
  'isEditableTarget',
  'hasPlainText'
]) {
  assertIncludes(webview, pasteWebviewToken, 'paste reference image webview contract');
}

for (const pasteBridgeToken of [
  'optimizeTextReadClipboardImage',
  'read-clipboard-image',
  'requestOptimizeTextClipboardImage',
  'optimizeTextImageHintReset'
]) {
  assertIncludes(uxpBridge, pasteBridgeToken, 'paste reference image UXP bridge contract');
}

for (const clipboardHandlerToken of [
  'read-clipboard-image',
  'clipboard.readImage',
  'CLIPBOARD_IMAGE_MAX_EDGE',
  '剪贴板中没有图片内容',
  // 透明图必须合成白底再转 JPEG，与 webview 粘贴路径行为一致（否则透明区变黑底）
  'flattenImageToWhite'
]) {
  assertIncludes(webviewHandlers, clipboardHandlerToken, 'agent clipboard image handler contract');
}

// 参考图 mediaType 按字节签名识别，不再硬编码（画布快照/剪贴板均为 jpeg 却曾被标 png）
assertIncludes(textHandler, 'mediaType: resolveImageMediaType(params.image)', 'image media type sniffing contract');
if (textHandler.split('mediaType: resolveImageMediaType(params.image)').length - 1 !== 2) {
  throw new Error('image media type sniffing contract: 首轮与重试两处 image 赋值都必须走 resolveImageMediaType');
}

for (const strictCandidateUiToken of [
  'canApply',
  '不符合版式',
  'optimize-apply-btn'
]) {
  assertIncludes(webview, strictCandidateUiToken, 'strict copywriting candidate UI');
}

for (const integrationToken of [
  'buildCopywritingContextChecklist',
  'formatCopywritingFrameworkForPrompt',
  'copywritingContext.missing'
]) {
  assertIncludes(textHandler, integrationToken, 'text handler copywriting framework integration');
}

for (const frameworkToken of [
  'COPYWRITING_TEMPLATES',
  'COPYWRITING_SCORE_CRITERIA',
  'COPYWRITING_SAFETY_RULES',
  'buildCopywritingContextChecklist',
  'formatCopywritingFrameworkForPrompt',
  '图文文案撰写框架',
  '目标人群 + 兴趣方向 + 图片真实信息 + 用户使用场景 + 产品解决的问题 + 有记忆点的表达',
  'COPYWRITING_PROCESS',
  'COPYWRITING_PISBFC'
]) {
  assertIncludes(copywritingFramework, frameworkToken, 'copywriting framework module');
}

const mojibakeSamples = [0x9359, 0x7487, 0x923F, 0xFFFD].map(codePoint => String.fromCodePoint(codePoint));

for (const mojibake of mojibakeSamples) {
  assertNotIncludes(webview, mojibake, 'webview');
  assertNotIncludes(textHandler, mojibake, 'text handler');
  assertNotIncludes(uxpBridge, mojibake, 'UXP bridge');
  assertNotIncludes(copywritingFramework, mojibake, 'copywriting framework');
  assertNotIncludes(taskOrchestrator, mojibake, 'task orchestrator');
  assertNotIncludes(webviewHandlers, mojibake, 'webview handlers');
}

console.log(JSON.stringify({
  success: true,
  checks: [
    'copywriting UI keeps only style, target audience, retained keywords, product brief, reference image, and candidate cards',
    'copywriting UI includes target audience as the minimal people/interest input',
    'copy optimization UI removes design context and adjustment-boundary modules',
    'copywriting UI and UXP bridge do not show timed fake model-progress stages',
    'copy optimization candidate cards expose fit status and detail evidence',
    'copywriting framework is available to the Agent prompt without fake thinking',
    'webview sends only the simplified user-facing fields to UXP',
    'UXP and Agent keep compatibility for legacy structured fields',
    'Agent prompt, candidate filtering, and candidate detail generation consume compatible fields',
    'candidate acceptance is tiered (ok/watch/risk) instead of all-or-nothing skeleton filtering',
    'retry prompt carries previous failed candidates with concrete violation reasons',
    'text-optimize sends its own instructions via systemPromptOverride without stacking the legacy prompt',
    'non-vision models never receive images and get an explicit visual-evidence-unavailable note',
    'watch tier candidates can be applied from the UI with a layout-check reminder',
    'reference image supports panel Ctrl+V paste plus a clipboard-read fallback via the Agent'
  ]
}, null, 2));
