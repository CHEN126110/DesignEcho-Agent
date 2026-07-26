#!/usr/bin/env node

const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const repoRoot = path.resolve(__dirname, '..');
const NATURAL_SKU_CAPABILITY_REPLY = '能做，SKU 这块我会按组合图和自选备注来理解。';

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function assertNoRawPayload(value, label) {
  const serialized = JSON.stringify(value);
  const forbidden = ['raw-image-payload', 'base64-image-payload', 'data:image/'];
  const found = forbidden.filter((token) => serialized.includes(token));
  assert(found.length === 0, `${label} must not retain raw image-like payloads: ${found.join(', ')}`, value);
}

function assertNoConfidence(value, label) {
  const serialized = JSON.stringify(value);
  assert(!serialized.includes('"confidence"') && !serialized.includes('置信'), `${label} must not expose confidence fields`, value);
}

function assertDesignerFacingLanguage(value, label) {
  const text = String(value || '');
  const forbidden = [
    'Agent response knowledge bundle',
    'version=',
    'persona=',
    'responseStyle=',
    'enabledUserFacingSkills=',
    'projectImages=',
    'selectedProjectImage=',
    'preferenceBoundary=',
    'knowledgeBoundary=',
    'guardrails=',
    'prompt_context',
    'user_reference',
    '回复知识契约'
  ];
  const found = forbidden.filter((token) => text.includes(token));
  assert(found.length === 0, `${label} should use designer-facing language instead of internal contract labels: ${found.join(', ')}`, text);
}

function assertThinkingToolBoundary(value, label) {
  const text = String(value || '');
  assert(
    /(Agent|智能体|模型).{0,24}(理解|判断|规划|设计判断|选择)|(?:理解|判断|规划|设计判断).{0,24}(Agent|智能体|模型)/u.test(text),
    `${label} should state that the agent/model owns understanding, planning and design judgment`,
    text
  );
  assert(
    /工具.{0,24}(执行|能力|定义|边界|输入|输出)|(?:执行|能力|定义|边界|输入|输出).{0,24}工具/u.test(text),
    `${label} should frame tools as clearly defined execution capabilities instead of the thinking layer`,
    text
  );
  assert(
    /(确认|用户).{0,24}(偏好|风险|不可逆|授权)|(?:偏好|风险|不可逆|授权).{0,24}(确认|用户)/u.test(text),
    `${label} should keep user confirmation for preference, risk or authorization boundaries`,
    text
  );
  assert(
    !/(得靠人来把关|交给用户自己判断|由用户自己把关|工具替不了你想|模型只会用工具)/u.test(text),
    `${label} must not downgrade the agent into a tool-only executor`,
    text
  );
}

function createLocalStorageMock() {
  const data = new Map();
  return {
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, String(value));
    },
    removeItem(key) {
      data.delete(key);
    },
    clear() {
      data.clear();
    }
  };
}

global.localStorage = createLocalStorageMock();

const {
  buildAgentResponseKnowledgeBundle,
  renderAgentResponseKnowledgePromptSection
} = require(path.join(repoRoot, 'src', 'shared', 'agent-response-knowledge.ts'));
const { getMemoryService } = require(path.join(repoRoot, 'src', 'renderer', 'services', 'memory.service.ts'));
const conversational = require(path.join(repoRoot, 'src', 'renderer', 'services', 'agent-orchestration', 'conversational.ts'));
const { governDesignKnowledgeResult } = require(path.join(repoRoot, 'src', 'shared', 'design-knowledge-governance.ts'));

function governKnowledgeFixtures(items) {
  return items.map((item) => governDesignKnowledgeResult(item, {
    provenance: 'local_reviewed',
    sourceRevision: `response-smoke:${item.id}:v1`,
    retrievedAt: '2026-07-12T00:00:00.000Z'
  }));
}

function runSharedContractChecks() {
  const bundle = buildAgentResponseKnowledgeBundle({
    userText: '用户请求 raw-image-payload data:image/png;base64,abc',
    skillFacts: [
      { id: 'main-image-design', name: 'Main Image Design', visibility: 'user-facing', enabled: true },
      { id: 'sku-batch', name: 'SKU Batch', visibility: 'user-facing', enabled: true },
      { id: 'autonomous-agent', name: '自主智能体', visibility: 'system-only', enabled: true },
      { id: 'detail-page-design', name: 'Detail Page Design', visibility: 'user-facing', enabled: false }
    ],
    preferenceItems: [
      {
        id: 'explicit-font',
        category: 'font',
        value: '阿里巴巴普惠体',
        label: '标题字体偏好',
        sourceType: 'explicit',
        status: 'active',
        sourceNote: '用户明确设置标题优先使用阿里巴巴普惠体。'
      },
      {
        id: 'inferred-font',
        category: 'font',
        value: '思源黑体',
        label: '推断字体',
        sourceType: 'inferred',
        status: 'needs_review',
        sourceNote: '从历史操作推断，不能直接使用。'
      },
      {
        id: 'disabled-style',
        category: 'style',
        value: '复古',
        label: '已禁用风格',
        sourceType: 'explicit',
        status: 'disabled',
        sourceNote: '用户已禁用。'
      },
      {
        id: 'legacy-color',
        category: 'color',
        value: '奶白',
        label: '旧版颜色',
        sourceType: 'deprecated',
        status: 'active',
        sourceNote: '来自旧字段。'
      }
    ],
    knowledgeResults: governKnowledgeFixtures([
      {
        id: 'local-memory:explicit-font',
        title: '标题字体偏好',
        intent: 'rule',
        sourceType: 'local_case',
        summary: '用户明确设置标题优先使用阿里巴巴普惠体。',
        sourceNotes: ['来源：explicit_user_feedback'],
        tags: ['design-memory', 'user_preference', 'font', 'explicit_user_feedback'],
        allowedUses: ['prompt_context', 'user_reference'],
        sourceLevel: 'local_case',
        sourceRank: 88
      },
      {
        id: 'local-memory:inferred-font',
        title: '推断字体',
        intent: 'rule',
        sourceType: 'local_case',
        summary: '从历史操作推断。',
        sourceNotes: ['来源：inferred_from_operations'],
        tags: ['design-memory', 'user_preference', 'font', 'inferred_from_operations'],
        allowedUses: ['prompt_context'],
        sourceLevel: 'local_case',
        sourceRank: 52
      },
      {
        id: 'local-memory:direct-action',
        title: '直接动作',
        intent: 'rule',
        sourceType: 'local_case',
        summary: '只能用于 Photoshop 写入动作。',
        sourceNotes: ['direct action only'],
        tags: ['design-memory'],
        allowedUses: ['direct_photoshop_action'],
        sourceLevel: 'local_case',
        sourceRank: 100
      },
      {
        id: 'local-memory:approved-learning-socks-card',
        title: '袜子 SKU 色卡整齐排布经验',
        intent: 'reference',
        sourceType: 'local_case',
        summary: '整齐重复、统一阴影和充足留白能让袜子 SKU 色卡更干净可信。好在哪儿：袜口齐平、间距稳定、影子方向统一；为什么有效：降低颜色对比时的视觉噪音；适用：基础袜 SKU 色卡 / 白底组合展示。',
        sourceNotes: [
          '记忆类型：visual_case',
          '来源：imported_case',
          'design-learning-experience：reference=eagle-case:socks-card; review=reviewed_approved; heuristics=3'
        ],
        tags: ['design-memory', 'visual_case', 'imported_case', 'design-learning', 'visual-case', 'socks', 'sku'],
        allowedUses: ['prompt_context', 'user_reference', 'recipe_hint'],
        sourceLevel: 'local_case',
        sourceRank: 76
      },
      {
        id: 'local-memory:pending-learning-socks-card',
        title: '待审袜子色卡经验',
        intent: 'reference',
        sourceType: 'local_case',
        summary: '待审经验不能直接进入回复上下文。',
        sourceNotes: ['design-learning-experience：review=needs_human_review'],
        tags: ['design-memory', 'visual_case', 'imported_case', 'design-learning', 'needs_review'],
        allowedUses: ['prompt_context', 'user_reference'],
        sourceLevel: 'local_case',
        sourceRank: 0
      }
    ]),
    projectContext: {
      projectPath: 'C:/project/C-1160',
      projectImageCount: 12,
      selectedProjectImageName: 'white-socks.jpg'
    }
  });

  assert(bundle.version === 'agent-response-knowledge/v0', 'response knowledge bundle version mismatch', bundle);
  assert(
    /设计师|设计搭档|设计伙伴/.test(bundle.persona.role),
    'response persona should define a designer-facing role',
    bundle.persona
  );
  assert(
    bundle.persona.responseStyle.some((item) => /设计|审美|版式|文案|用户/.test(item)) &&
      !bundle.persona.responseStyle.some((item) => /工具循环|契约|runner|debug|调试/.test(item)),
    'response style should guide designer-like communication without debug language',
    bundle.persona
  );
  assertThinkingToolBoundary(bundle.persona.responseStyle.join('\n'), 'response persona style');
  assert(bundle.guardrails.noPhotoshopExecution === true, 'response bundle must be read-only', bundle.guardrails);
  assert(bundle.guardrails.noToolSimulation === true, 'response bundle must prevent tool simulation', bundle.guardrails);
  assert(bundle.guardrails.noConfidence === true, 'response bundle must disallow confidence', bundle.guardrails);
  assert(bundle.capabilities.enabledUserFacingSkills.includes('Main Image Design'), 'enabled user-facing skill should be visible', bundle.capabilities);
  assert(bundle.capabilities.enabledUserFacingSkills.includes('SKU Batch'), 'second enabled user-facing skill should be visible', bundle.capabilities);
  assert(
    Array.isArray(bundle.domainGlossary?.items) &&
      bundle.domainGlossary.items.some((item) => /2双、3双、4双/.test(item.meaning) && /自选备注/.test(item.term)),
    'response knowledge should carry SKU domain terminology for self-select note semantics',
    bundle.domainGlossary
  );
  assert(!bundle.capabilities.enabledUserFacingSkills.includes('自主智能体'), 'system-only skill must not enter user capability facts', bundle.capabilities);
  assert(!bundle.capabilities.enabledUserFacingSkills.includes('Detail Page Design'), 'disabled skill must not enter user capability facts', bundle.capabilities);
  assert(bundle.preferences.activeExplicitPreferences.some((item) => item.value === '阿里巴巴普惠体'), 'active explicit preference should be included', bundle.preferences);
  assert(bundle.preferences.activeExplicitPreferences.every((item) => item.value !== '思源黑体'), 'needs_review inferred preference must not become active response preference', bundle.preferences);
  assert(bundle.preferences.activeExplicitPreferences.every((item) => item.value !== '复古'), 'disabled preference must not become active response preference', bundle.preferences);
  assert(bundle.preferences.activeExplicitPreferences.every((item) => item.value !== '奶白'), 'deprecated preference must not become active response preference', bundle.preferences);
  assert(bundle.preferences.excludedPreferenceCount === 3, 'excluded preference count should reflect non-active-explicit items', bundle.preferences);
  assert(bundle.knowledge.contextItems.length === 2, 'safe explicit preference and approved design-learning knowledge should be included', bundle.knowledge);
  assert(bundle.knowledge.contextItems[0].title === '标题字体偏好', 'safe explicit knowledge should be preserved', bundle.knowledge);
  assert(
    bundle.knowledge.contextItems.some((item) => item.title === '袜子 SKU 色卡整齐排布经验' && item.summary.includes('好在哪儿') && item.summary.includes('适用')),
    'approved design-learning visual cases should become reusable response knowledge',
    bundle.knowledge
  );
  assert(bundle.knowledge.excludedKnowledgeCount === 3, 'unsafe or unreviewed knowledge should be excluded', bundle.knowledge);
  assert(bundle.project.availableProjectImages === 12, 'project image count should be summarized', bundle.project);
  assertNoRawPayload(bundle, 'response knowledge bundle');
  assertNoConfidence(bundle, 'response knowledge bundle');

  const promptSection = renderAgentResponseKnowledgePromptSection(bundle);
  assert(promptSection.includes('## 设计师回复参考'), 'prompt section should have a designer-facing heading', promptSection);
  assert(promptSection.includes('设计师'), 'prompt section should position the assistant as a designer partner', promptSection);
  assert(promptSection.includes('阿里巴巴普惠体'), 'prompt section should include active explicit preference', promptSection);
  assert(promptSection.includes('Main Image Design'), 'prompt section should include live skill facts', promptSection);
  assert(
    promptSection.includes('袜子 SKU 色卡整齐排布经验') && promptSection.includes('好在哪儿') && promptSection.includes('适用'),
    'prompt section should include approved design-learning experience as reusable designer reference',
    promptSection
  );
  assert(!promptSection.includes('待审袜子色卡经验'), 'prompt section must not include unreviewed design-learning experience', promptSection);
  assert(
    promptSection.includes('2双、3双、4双') && promptSection.includes('自选备注') && promptSection.includes('不改模板占位符'),
    'prompt section should include SKU terminology that prevents self-select note semantic drift',
    promptSection
  );
  assert(!promptSection.includes('思源黑体'), 'prompt section must not include unreviewed inferred preference', promptSection);
  assert(!promptSection.includes('复古'), 'prompt section must not include disabled preference', promptSection);
  assert(!promptSection.includes('奶白'), 'prompt section must not include deprecated preference', promptSection);
  assertDesignerFacingLanguage(promptSection, 'response knowledge prompt section');
  assertThinkingToolBoundary(promptSection, 'response knowledge prompt section');
  assertNoRawPayload(promptSection, 'response knowledge prompt section');
  assertNoConfidence(promptSection, 'response knowledge prompt section');
}

async function runConversationalIntegrationChecks() {
  const memory = getMemoryService();
  memory.upsertExplicitPreference({
    category: 'font',
    value: '阿里巴巴普惠体',
    label: '标题字体偏好',
    sourceNote: '用户明确要求标题优先使用阿里巴巴普惠体。'
  });

  let capturedSystemPrompt = '';
  let capturedOptions = null;
  const reply = await conversational.tryConversationalModelReply(
    {
      userInput: '你会做什么？',
      conversationHistory: [],
      isPluginConnected: true,
      photoshopContext: { hasDocument: true, documentName: 'demo.psd', layerCount: 8 },
      projectContext: { projectPath: 'C:/project/C-1160', projectImageCount: 6 }
    },
    async (messages, options) => {
      capturedSystemPrompt = String(messages?.[0]?.content || '');
      capturedOptions = options;
      return { text: '我可以先理解项目素材和你的设计目标，再给出适合当前商品的视觉判断；真正需要改图时再检查 PSD、素材和版面空间。' };
    }
  );

  assert(reply.includes('项目素材'), 'model reply should be returned as text', reply);
  assert(capturedOptions?.purpose === 'direct_response', 'conversational model call must stay direct_response', capturedOptions);
  assert(capturedOptions?.stream === false, 'capability direct_response should be buffered until the reply passes natural-language gates', capturedOptions);
  assert(capturedOptions?.deferVisibleStream === true, 'capability answers should keep visible streaming deferred until the reply passes natural-language gates', capturedOptions);
  assert(capturedSystemPrompt.includes('## 设计师回复参考'), 'conversation prompt should include designer-facing response knowledge', capturedSystemPrompt);
  assert(capturedSystemPrompt.includes('阿里巴巴普惠体'), 'conversation prompt should include active explicit preference', capturedSystemPrompt);
  assert(capturedSystemPrompt.includes('2双、3双、4双') && capturedSystemPrompt.includes('自选备注'), 'conversation prompt should include SKU domain glossary', capturedSystemPrompt);
  assert(!capturedSystemPrompt.includes('当前项目可参考 6 张图片'), 'general capability chat should not inject project image counts into the model prompt', capturedSystemPrompt);
  assert(!capturedSystemPrompt.includes('当前项目中已扫描到 6 张图片'), 'general capability chat should not advertise scanned project images', capturedSystemPrompt);
  assert(capturedSystemPrompt.includes('本轮问题不需要引用项目素材上下文'), 'general capability chat should scope project context out instead of claiming project facts', capturedSystemPrompt);
  assert(capturedSystemPrompt.includes('本轮不需要引用当前项目素材信息'), 'general capability chat should include an explicit project fact boundary', capturedSystemPrompt);
  assert(capturedSystemPrompt.includes('不要根据历史对话、领域术语或能力范围断言当前项目已有素材'), 'conversation prompt should forbid unsupported current-project resource claims', capturedSystemPrompt);
  assert(capturedSystemPrompt.includes('用户是在问总体能力，不是在要求现在开始处理文件'), 'capability chat should stay in conversational capability mode using user-facing wording', capturedSystemPrompt);
  assert(!capturedSystemPrompt.includes('在当前电商袜子项目里'), 'conversation prompt must not make SKU glossary look like a current-project fact', capturedSystemPrompt);
  assert(!capturedSystemPrompt.includes('在当前电商袜子项目语境里'), 'response knowledge glossary must not bind SKU terminology to the current project without evidence', capturedSystemPrompt);
  assert(!capturedSystemPrompt.includes('工具边界不是思维边界'), 'conversation prompt should not expose developer-era tool/thinking slogans', capturedSystemPrompt);
  assert(!capturedSystemPrompt.includes('不要为了证明未执行工具'), 'conversation prompt should not frame replies around proving that tools were not executed', capturedSystemPrompt);
  assert(!capturedSystemPrompt.includes('执行前确认项'), 'conversation prompt should not use technical pre-execution-confirmation wording for ordinary chat', capturedSystemPrompt);
  assert(!capturedSystemPrompt.includes('Smart Layout、SKU Config Prep、SKU Batch'), 'general capability prompt must not embed the full raw skill menu', capturedSystemPrompt);
  assert(!capturedSystemPrompt.includes('当前启用的设计方向'), 'general capability prompt must not use menu-like capability labels that encourage canned replies', capturedSystemPrompt);
  assert(!capturedSystemPrompt.includes('我可以协助这些设计工作'), 'general capability prompt must not quote the old canned capability reply even as a negative example', capturedSystemPrompt);
  assert(!capturedSystemPrompt.includes('能力清单'), 'general capability prompt must not expose list-like wording that encourages menu replies', capturedSystemPrompt);
  assert(!capturedSystemPrompt.includes('思源黑体'), 'conversation prompt must not include unreviewed inferred preference', capturedSystemPrompt);
  assertDesignerFacingLanguage(capturedSystemPrompt, 'conversation prompt response knowledge');
  assertThinkingToolBoundary(capturedSystemPrompt, 'conversation prompt response knowledge');
  assert(!capturedSystemPrompt.includes('"confidence"') && !capturedSystemPrompt.includes('置信'), 'conversation prompt must not ask for confidence', capturedSystemPrompt);
  assert(capturedSystemPrompt.includes('不要输出 JSON'), 'conversation prompt should still forbid JSON replies', capturedSystemPrompt);

  const detailPlanInput = '请基于当前项目中的 SKU 色卡素材，创建一个详情页文档。按照文档名称区分：详情页文档就是详情页，SKU 就是 SKU。本轮先给出设计计划，不要写入 Photoshop。';
  const detailPlanPrompts = [];
  const detailPlanOptions = [];
  let detailPlanCallCount = 0;
  const detailPlanReply = await conversational.tryConversationalModelReply(
    {
      userInput: detailPlanInput,
      conversationHistory: [],
      isPluginConnected: true,
      photoshopContext: { hasDocument: true, documentName: 'demo.psd', layerCount: 8 },
      projectContext: { projectPath: 'C:/project/C-1194', projectImageCount: 93 }
    },
    async (messages, options) => {
      detailPlanCallCount += 1;
      detailPlanPrompts.push(String(messages?.[0]?.content || ''));
      detailPlanOptions.push(options);
      if (detailPlanCallCount === 1) {
        return { text: '我需要先确认以下信息来制定设计计划：1. 哪些是 SKU 色卡素材？2. 目标尺寸是多少？3. 有没有参考图？请告诉我这些信息。' };
      }
      return { text: '本轮只规划详情页文档：SKU 色卡作为素材来源，用于详情页里的色卡展示区；如果继续执行，我会先检查素材、文档和版面空间，不会在本轮写入 Photoshop。' };
    }
  );
  assert(detailPlanCallCount === 2, 'plan-only reply that asks the user for missing info should be repaired once', { detailPlanCallCount, detailPlanReply });
  assert(detailPlanOptions[0]?.stream === true, 'plan-only direct response should use provider streaming for real-model compatibility', detailPlanOptions);
  assert(detailPlanOptions[0]?.deferVisibleStream === true, 'plan-only direct response should buffer visible streaming until the reply passes natural-language gates', detailPlanOptions);
  assert(detailPlanPrompts.every((prompt) => prompt.includes('当前是只规划请求')), 'plan-only conversational prompts should include no-write planning boundary', detailPlanPrompts);
  assert(detailPlanPrompts.every((prompt) => prompt.includes('被创建的那个文档才是目标，素材只是输入来源')), 'plan-only prompt should keep material source separate from deliverables', detailPlanPrompts);
  assert(detailPlanPrompts.every((prompt) => !prompt.includes('计划控制在 4 句以内')), 'plan-only prompt should not contain the old leak-prone wording', detailPlanPrompts);
  assert(detailPlanPrompts.every((prompt) => prompt.includes('输出时直接写给用户的自然短段')), 'plan-only prompt should frame output as user-facing natural writing', detailPlanPrompts);
  assert(!/同时创建.*SKU\s*文档|单独创建.*SKU\s*文档/.test(detailPlanReply), 'plan-only reply must not add a SKU document when user requested a detail-page document', detailPlanReply);

  let structuredPlanCallCount = 0;
  const structuredPlanReply = await conversational.tryConversationalModelReply(
    {
      userInput: detailPlanInput,
      conversationHistory: [],
      isPluginConnected: true,
      photoshopContext: { hasDocument: true, documentName: 'demo.psd', layerCount: 8 },
      projectContext: { projectPath: 'C:/project/C-1194', projectImageCount: 93 }
    },
    async () => {
      structuredPlanCallCount += 1;
      return {
        text: '好的，我理解你的需求。基于当前项目中的 SKU 色卡素材，我计划创建一个电商详情页文档。\\n\\n**设计计划：**\\n\\n1. **目标交付物**：创建一个独立的详情页 PSD 文档，文件名明确为“详情页”，与 SKU 文档区分。\\n\\n2. **素材来源**：使用当前项目中已有的 SKU 色卡素材作为详情页的产品展示核心元素。\\n\\n3. **版面结构**：详情页采用顶部主视觉、核心卖点、SKU 色卡展示和底部信息区。'
      };
    }
  );
  assert(structuredPlanCallCount === 1, 'plan-only structured design plan should not be rejected as a canned capability menu', { structuredPlanCallCount, structuredPlanReply });
  assert(structuredPlanReply.includes('目标交付物') && structuredPlanReply.includes('详情页 PSD 文档'), 'plan-only structured design plan should preserve model-authored plan content', structuredPlanReply);

  let generalCapabilityMenuCallCount = 0;
  const repairedGeneralCapabilityMenuReply = await conversational.tryConversationalModelReply(
    {
      userInput: '你可以做什么？',
      conversationHistory: [],
      isPluginConnected: true,
      photoshopContext: { hasDocument: true, documentName: 'demo.psd', layerCount: 8 },
      projectContext: { projectPath: 'C:/project/C-1160', projectImageCount: 6 }
    },
    async () => {
      generalCapabilityMenuCallCount += 1;
      if (generalCapabilityMenuCallCount === 1) {
        return {
          text: '作为您的设计搭档，我可以：\n1. **视觉方案设计** - 根据产品卖点设计SKU主视觉。\n2. **规格组合图制作** - 将您提供的单品图批量生成2双装、3双装等组合形式。\n3. **问题定位** - 如果现有SKU图效果不理想，可以分析问题。\n**现在最需要解决哪类问题？** 您手头有素材或参考案例吗？'
        };
      }
      return { text: '我能帮你判断电商图片的版式、文案和素材落地方式，任务明确后再处理设计文档。' };
    }
  );
  assert(generalCapabilityMenuCallCount === 2, 'general capability Markdown menu should be rejected and repaired once', { generalCapabilityMenuCallCount, repairedGeneralCapabilityMenuReply });
  assert(!repairedGeneralCapabilityMenuReply.includes('**'), 'repaired general capability reply must not keep Markdown emphasis', repairedGeneralCapabilityMenuReply);
  assert(!/(^|\n)\d+[.、]/u.test(repairedGeneralCapabilityMenuReply), 'repaired general capability reply must not keep numbered menu layout', repairedGeneralCapabilityMenuReply);
  assert(!repairedGeneralCapabilityMenuReply.includes('现在最需要解决哪类问题'), 'repaired general capability reply must not end as an execution solicitation', repairedGeneralCapabilityMenuReply);

  let sectionedGeneralCapabilityMenuCallCount = 0;
  const repairedSectionedGeneralCapabilityMenuReply = await conversational.tryConversationalModelReply(
    {
      userInput: '你可以做什么？',
      conversationHistory: [],
      isPluginConnected: true,
      photoshopContext: { hasDocument: true, documentName: 'demo.psd', layerCount: 8 },
      projectContext: { projectPath: 'C:/project/C-1160', projectImageCount: 6 }
    },
    async () => {
      sectionedGeneralCapabilityMenuCallCount += 1;
      if (sectionedGeneralCapabilityMenuCallCount === 1) {
        return {
          text: '简单说，我是你的电商视觉设计搭档，主要帮你搞定这些： **设计判断和规划** 帮你理清画面要突出什么卖点、版式怎么排、风格往哪走。 **主图、详情页、SKU 组合图** 根据你的商品素材、文案和配置，帮你生成或调整这些常见的电商物料。 **素材整理和文档处理** 比如根据 SKU 配置批量生成组合图、自选备注图。你现在有具体的设计需求，还是先随便聊聊？'
        };
      }
      return { text: '我能帮你做电商图片的设计判断和落地处理，主图、SKU、详情页、素材理解和文字版式都能协助。' };
    }
  );
  assert(sectionedGeneralCapabilityMenuCallCount === 2, 'sectioned Markdown capability menu should be rejected and repaired once', { sectionedGeneralCapabilityMenuCallCount, repairedSectionedGeneralCapabilityMenuReply });
  assert(!repairedSectionedGeneralCapabilityMenuReply.includes('**'), 'repaired sectioned capability reply must not keep Markdown headings', repairedSectionedGeneralCapabilityMenuReply);
  assert(!repairedSectionedGeneralCapabilityMenuReply.includes('你现在有具体的设计需求'), 'repaired sectioned capability reply must not keep execution solicitation tail', repairedSectionedGeneralCapabilityMenuReply);

  let longGeneralCapabilityOverviewCallCount = 0;
  const repairedLongGeneralCapabilityOverviewReply = await conversational.tryConversationalModelReply(
    {
      userInput: '你可以做什么？',
      conversationHistory: [],
      isPluginConnected: true,
      photoshopContext: { hasDocument: true, documentName: 'demo.psd', layerCount: 8 },
      projectContext: { projectPath: 'C:/project/C-1160', projectImageCount: 6 }
    },
    async () => {
      longGeneralCapabilityOverviewCallCount += 1;
      if (longGeneralCapabilityOverviewCallCount === 1) {
        return {
          text: '你好，我是你的电商视觉设计搭档，主要帮你处理这些事情：电商主图、详情页、SKU 组合图这类日常出图，我可以根据你的素材和要求直接排版、调色、出图。如果有现成的 PSD 模板，我可以按模板结构批量处理，比如换产品、换文案、换背景。素材整理、图层管理、文件导出这些脏活累活我也能接手。另外，如果你在构思方案、纠结风格方向、不确定怎么突出卖点，也可以先跟我聊，我帮你理清思路再动手。简单说，你告诉我想要什么效果、有什么素材，我来判断怎么实现，能直接做的就做，需要确认的会先跟你对齐。'
        };
      }
      return { text: '我可以帮你做电商图片的设计判断和落地处理，主图、SKU、详情页、素材理解和文字版式都在范围内。' };
    }
  );
  assert(longGeneralCapabilityOverviewCallCount === 2, 'long paragraph capability overview should be rejected and repaired once', { longGeneralCapabilityOverviewCallCount, repairedLongGeneralCapabilityOverviewReply });
  assert((repairedLongGeneralCapabilityOverviewReply.match(/[。！？!?]/gu) || []).length <= 2, 'repaired long capability overview should stay concise', repairedLongGeneralCapabilityOverviewReply);
  assert(!repairedLongGeneralCapabilityOverviewReply.includes('主要帮你处理这些事情'), 'repaired long capability overview must not keep intro-menu framing', repairedLongGeneralCapabilityOverviewReply);

  let naturalGeneralCapabilityCallCount = 0;
  const naturalGeneralCapabilityReply = await conversational.tryConversationalModelReply(
    {
      userInput: '你可以做什么？',
      conversationHistory: [],
      isPluginConnected: true,
      photoshopContext: { hasDocument: true, documentName: 'demo.psd', layerCount: 8 },
      projectContext: { projectPath: 'C:/project/C-1160', projectImageCount: 6 }
    },
    async () => {
      naturalGeneralCapabilityCallCount += 1;
      return { text: '我可以围绕电商图片设计提供判断和落地支持，包括主图、SKU、详情页、素材理解和文案排版；真正开始处理前会先检查素材、PSD 和版面空间。' };
    }
  );
  assert(naturalGeneralCapabilityCallCount === 1, 'natural general capability answer should not be rejected only because it mentions multiple design domains', { naturalGeneralCapabilityCallCount, naturalGeneralCapabilityReply });
  assert(naturalGeneralCapabilityReply.includes('主图') && naturalGeneralCapabilityReply.includes('SKU') && naturalGeneralCapabilityReply.includes('详情页'), 'natural general capability answer should keep model-authored domain coverage', naturalGeneralCapabilityReply);

  let unsupportedProjectFactCallCount = 0;
  const repairedUnsupportedProjectFactReply = await conversational.tryConversationalModelReply(
    {
      userInput: '你会做SKU吗',
      conversationHistory: [
        { role: 'user', content: '帮我做一下SKU' },
        { role: 'assistant', content: '当前项目是电商袜子项目，项目里已经有袜子素材图片，可以直接基于项目素材做组合图。' }
      ],
      isPluginConnected: true,
      photoshopContext: { hasDocument: true, documentName: 'demo.psd', layerCount: 8 },
      projectContext: { projectPath: 'C:/project/C-1169', projectImageCount: 0 }
    },
    async () => {
      unsupportedProjectFactCallCount += 1;
      if (unsupportedProjectFactCallCount === 1) {
        return { text: '会，当前项目是电商袜子项目，项目里已经有袜子素材图片，我可以基于这些素材做 SKU 组合图。' };
      }
      return { text: NATURAL_SKU_CAPABILITY_REPLY };
    }
  );
  assert(unsupportedProjectFactCallCount === 2, 'unsupported current-project facts should be rejected and repaired once', { unsupportedProjectFactCallCount, repairedUnsupportedProjectFactReply });
  assert(repairedUnsupportedProjectFactReply === NATURAL_SKU_CAPABILITY_REPLY, 'repaired unsupported project-fact reply should keep a natural capability answer', repairedUnsupportedProjectFactReply);
  assert(!/当前项目.*(袜子|素材|图片)|项目里已经有/u.test(repairedUnsupportedProjectFactReply), 'repaired reply must not preserve unsupported project facts', repairedUnsupportedProjectFactReply);

  let capturedHistoryBoundaryMessages = null;
  await conversational.tryConversationalModelReply(
    {
      userInput: '你会做SKU吗',
      conversationHistory: [
        { role: 'user', content: '帮我做一下SKU' },
        { role: 'assistant', content: '当前项目是电商袜子项目，项目里已经有袜子素材图片，可以直接基于项目素材做组合图。' }
      ],
      isPluginConnected: true,
      photoshopContext: { hasDocument: true, documentName: 'demo.psd', layerCount: 8 },
      projectContext: { projectPath: 'C:/project/C-1169', projectImageCount: 0 }
    },
    async (messages) => {
      capturedHistoryBoundaryMessages = messages;
      return { text: NATURAL_SKU_CAPABILITY_REPLY };
    }
  );
  assert(!JSON.stringify(capturedHistoryBoundaryMessages).includes('项目里已经有袜子素材图片'), 'unsupported project-fact history should be filtered before the model prompt', capturedHistoryBoundaryMessages);

  let capturedSkuCapabilityPrompt = '';
  const skuCapabilityReply = await conversational.tryConversationalModelReply(
    {
      userInput: '你会做SKU吗',
      conversationHistory: [],
      isPluginConnected: true,
      photoshopContext: { hasDocument: true, documentName: 'SKU.psb', layerCount: 16 },
      projectContext: { projectPath: 'C:/project/C-1163', projectImageCount: 9 }
    },
    async (messages, options) => {
      capturedSkuCapabilityPrompt = String(messages?.[0]?.content || '');
      assert(options?.purpose === 'direct_response', 'SKU capability answer should stay direct_response', options);
      assert(options?.stream === false, 'specific SKU capability answers should not stream unvetted template text before the quality gate', options);
      assert(options?.deferVisibleStream === true, 'SKU capability answer should not stream unvetted template text into the visible chat', options);
      return { text: NATURAL_SKU_CAPABILITY_REPLY };
    }
  );

  assert(skuCapabilityReply.includes('SKU'), 'SKU capability reply should be returned', skuCapabilityReply);
  assert(capturedSkuCapabilityPrompt.includes('SKU 组合图') && capturedSkuCapabilityPrompt.includes('自选备注'), 'SKU capability prompt should include semantic SKU capability context in Chinese', capturedSkuCapabilityPrompt);
  assert(capturedSkuCapabilityPrompt.includes('## 用户这次问到的能力范围'), 'specific capability prompt should use focused semantic context instead of the full response-knowledge bundle', capturedSkuCapabilityPrompt);

  let skuCapabilityNaturalProductionCallCount = 0;
  const skuCapabilityNaturalProductionReply = await conversational.tryConversationalModelReply(
    {
      userInput: '你会做SKU吗',
      conversationHistory: [],
      isPluginConnected: true,
      photoshopContext: { hasDocument: true, documentName: 'SKU.psb', layerCount: 16 },
      projectContext: { projectPath: 'C:/project/C-1163', projectImageCount: 9 }
    },
    async () => {
      skuCapabilityNaturalProductionCallCount += 1;
      return { text: '可以。我能根据当前 PSD 和 SKU 色卡生成组合图，也能处理自选备注；真正执行前会先检查模板、色卡和排版空间。' };
    }
  );
  assert(skuCapabilityNaturalProductionCallCount === 1, 'natural SKU capability answer should not be rejected only because it says it can generate SKU outputs', { skuCapabilityNaturalProductionCallCount, skuCapabilityNaturalProductionReply });
  assert(/组合图/.test(skuCapabilityNaturalProductionReply) && /自选备注/.test(skuCapabilityNaturalProductionReply), 'natural SKU capability answer should keep concrete capability details', skuCapabilityNaturalProductionReply);
  assert(capturedSkuCapabilityPrompt.includes('不要输出能力总览') && capturedSkuCapabilityPrompt.includes('能力菜单'), 'specific capability prompt should directly forbid menu-like capability answers', capturedSkuCapabilityPrompt);
  assert(!capturedSkuCapabilityPrompt.includes('## 设计师回复参考'), 'specific capability prompt must not inject the full response-knowledge bundle that encourages menu-style replies', capturedSkuCapabilityPrompt);
  assert(!capturedSkuCapabilityPrompt.includes('SKU Batch'), 'specific SKU capability prompt must not expose raw internal skill labels that make replies feel hardcoded', capturedSkuCapabilityPrompt);
  assert(!capturedSkuCapabilityPrompt.includes('当前启用的设计方向'), 'specific SKU capability prompt must not use menu-like capability labels', capturedSkuCapabilityPrompt);
  assert(!capturedSkuCapabilityPrompt.includes('相关能力：SKU Batch'), 'specific SKU capability prompt must not phrase internal skill names as related capabilities', capturedSkuCapabilityPrompt);
  assert(!capturedSkuCapabilityPrompt.includes('Main Image Design'), 'specific SKU capability prompt must not carry unrelated main-image skill menu items', capturedSkuCapabilityPrompt);
  assert(!capturedSkuCapabilityPrompt.includes('Detail Page Design'), 'specific SKU capability prompt must not carry unrelated detail-page skill menu items', capturedSkuCapabilityPrompt);
  assert(!capturedSkuCapabilityPrompt.includes('Design Reference Search'), 'specific SKU capability prompt must not carry unrelated reference-search skill menu items', capturedSkuCapabilityPrompt);
  assert(!capturedSkuCapabilityPrompt.includes('我可以协助这些设计工作'), 'specific capability prompt must not quote the old canned capability reply even as a negative example', capturedSkuCapabilityPrompt);
  assert(!capturedSkuCapabilityPrompt.includes('能力清单'), 'specific capability prompt must not expose list-like wording that encourages menu replies', capturedSkuCapabilityPrompt);
  assert(!/能力清单[:：].*(Main Image Design|Detail Page Design|Design Reference Search)/s.test(capturedSkuCapabilityPrompt), 'specific capability prompt must not embed the full capability menu after a no-repeat instruction', capturedSkuCapabilityPrompt);
  assert(!capturedSkuCapabilityPrompt.includes('并说明你会先读取项目资料并规划素材、规格、版式和交付结果'), 'specific capability prompt must not prescribe a fixed reply formula that makes the assistant sound hardcoded', capturedSkuCapabilityPrompt);
  assert(!capturedSkuCapabilityPrompt.includes('下一步如何开始'), 'specific capability prompt should let the model answer naturally instead of forcing a repeated next-step sentence', capturedSkuCapabilityPrompt);
  assert(!capturedSkuCapabilityPrompt.includes('当前项目可参考 9 张图片'), 'SKU capability question should not inject project image counts unless user asks project context', capturedSkuCapabilityPrompt);

  let cannedCapabilityCallCount = 0;
  const repairedSkuCapabilityReply = await conversational.tryConversationalModelReply(
    {
      userInput: '你会做SKU吗',
      conversationHistory: [
        {
          role: 'assistant',
          content: '我可以协助这些设计工作：主图、点击图、转化图和白底图规划、SKU 组合图和自选备注、详情页设计、模板检查和模板创建、项目图片理解、素材概览和设计参考检索、参考图复刻、图层、文档、文字和字体处理、电商袜子整套设计编排。你可以直接提出主图、SKU、详情页、项目图片理解、文档保存或图层调整需求；我会先判断它属于对话、只读检查还是需要进入处理流程。'
        }
      ],
      isPluginConnected: true,
      photoshopContext: { hasDocument: true, documentName: 'SKU.psb', layerCount: 16 },
      projectContext: { projectPath: 'C:/project/C-1163', projectImageCount: 9 }
    },
    async () => {
      cannedCapabilityCallCount += 1;
      if (cannedCapabilityCallCount === 1) {
        return {
          text: '我可以协助这些设计工作：主图、点击图、转化图和白底图规划、SKU 组合图和自选备注、详情页设计、模板检查和模板创建、项目图片理解、素材概览和设计参考检索、参考图复刻、图层、文档、文字和字体处理、电商袜子整套设计编排。你可以直接提出主图、SKU、详情页、项目图片理解、文档保存或图层调整需求；我会先判断它属于对话、只读检查还是需要进入处理流程。'
        };
      }
      return {
        text: NATURAL_SKU_CAPABILITY_REPLY
      };
    }
  );

  assert(cannedCapabilityCallCount === 2, 'old canned capability reply should be rejected and repaired once', { cannedCapabilityCallCount, repairedSkuCapabilityReply });
  assert(repairedSkuCapabilityReply.includes('SKU'), 'repaired SKU capability answer should still answer the asked capability', repairedSkuCapabilityReply);
  assert(!repairedSkuCapabilityReply.includes('我可以协助这些设计工作'), 'repaired SKU capability answer must not expose the old canned menu', repairedSkuCapabilityReply);
  assert(!repairedSkuCapabilityReply.includes('你可以直接提出主图、SKU、详情页'), 'repaired SKU capability answer must not reuse the old menu suffix', repairedSkuCapabilityReply);
  assert(!repairedSkuCapabilityReply.includes('我会先判断它属于对话、只读检查还是需要进入处理流程'), 'repaired SKU capability answer must not expose routing categories as user-facing copy', repairedSkuCapabilityReply);

  let reasoningOnlyCallCount = 0;
  const reasoningOnlyJsonReply = await conversational.tryConversationalModelReply(
    {
      userInput: '你会做SKU吗',
      conversationHistory: [],
      isPluginConnected: true,
      photoshopContext: { hasDocument: true, documentName: 'SKU.psb', layerCount: 16 },
      projectContext: { projectPath: 'C:/project/C-1163', projectImageCount: 9 }
    },
    async () => {
      reasoningOnlyCallCount += 1;
      if (reasoningOnlyCallCount === 1) {
        return {
          text: JSON.stringify({
            route: 'direct_response',
            reasoning: '用户是在询问 SKU 能力，不需要执行工具，应回答能做 SKU 组合和自选备注。'
          })
        };
      }
      return { text: NATURAL_SKU_CAPABILITY_REPLY };
    }
  );

  assert(reasoningOnlyCallCount === 2, 'reasoning-only JSON should be rejected and repaired once', { reasoningOnlyCallCount, reasoningOnlyJsonReply });
  assert(reasoningOnlyJsonReply === NATURAL_SKU_CAPABILITY_REPLY, 'reasoning-only JSON must not become the visible conversational reply', reasoningOnlyJsonReply);
  assert(!reasoningOnlyJsonReply.includes('用户是在询问'), 'visible reply must not expose model/router reasoning', reasoningOnlyJsonReply);

  let formulaicCapabilityCallCount = 0;
  const deTemplatedSkuCapabilityReply = await conversational.tryConversationalModelReply(
    {
      userInput: '你会做SKU吗',
      conversationHistory: [],
      isPluginConnected: true,
      photoshopContext: { hasDocument: true, documentName: 'SKU.psb', layerCount: 16 },
      projectContext: { projectPath: 'C:/project/C-1163', projectImageCount: 9 }
    },
    async () => {
      formulaicCapabilityCallCount += 1;
      if (formulaicCapabilityCallCount === 1) {
        return {
          text: '会的，SKU组合图是我的常用能力之一。简单来说，我能帮你做的是：根据项目里的SKU配置和素材，批量生成各规格的组合图；如果有多件规格（比如2双、3双、4双），还会自动生成对应的自选备注图。你直接说要做什么就行，我会先读取当前项目资料，看看素材和配置情况，然后给你一个执行方案。'
        };
      }
      return {
        text: NATURAL_SKU_CAPABILITY_REPLY
      };
    }
  );

  assert(formulaicCapabilityCallCount === 2, 'formulaic SKU capability explainer should be rejected and repaired once', { formulaicCapabilityCallCount, deTemplatedSkuCapabilityReply });
  assert(deTemplatedSkuCapabilityReply.includes('SKU'), 'de-templated SKU capability answer should still answer the asked capability', deTemplatedSkuCapabilityReply);
  assert(!deTemplatedSkuCapabilityReply.includes('我的常用能力之一'), 'de-templated SKU answer must avoid fixed onboarding-style self-description', deTemplatedSkuCapabilityReply);
  assert(!deTemplatedSkuCapabilityReply.includes('简单来说，我能帮你做的是'), 'de-templated SKU answer must avoid canned explainer openings', deTemplatedSkuCapabilityReply);
  assert(!deTemplatedSkuCapabilityReply.includes('你直接说要做什么就行'), 'de-templated SKU answer must avoid repeated next-step formulas', deTemplatedSkuCapabilityReply);
  assert(!deTemplatedSkuCapabilityReply.includes('给你一个执行方案'), 'de-templated SKU answer must avoid formulaic execution-plan promises in a capability question', deTemplatedSkuCapabilityReply);

  let solicitingCapabilityCallCount = 0;
  const repairedSolicitingSkuCapabilityReply = await conversational.tryConversationalModelReply(
    {
      userInput: '你会做SKU吗',
      conversationHistory: [],
      isPluginConnected: true,
      photoshopContext: { hasDocument: true, documentName: 'SKU.psb', layerCount: 16 },
      projectContext: { projectPath: 'C:/project/C-1163', projectImageCount: 9 }
    },
    async () => {
      solicitingCapabilityCallCount += 1;
      if (solicitingCapabilityCallCount === 1) {
        return {
          text: '当然可以帮你处理SKU相关的设计需求。比如袜子项目的SKU组合图、规格备注图这些，需要的话告诉我具体需求，比如要展示哪些规格组合或特殊备注，我可以帮你规划视觉方案。'
        };
      }
      return {
        text: NATURAL_SKU_CAPABILITY_REPLY
      };
    }
  );

  assert(solicitingCapabilityCallCount === 2, 'SKU capability answer that asks for execution details should be repaired once', { solicitingCapabilityCallCount, repairedSolicitingSkuCapabilityReply });
  assert(repairedSolicitingSkuCapabilityReply.includes('SKU'), 'repaired soliciting SKU answer should still answer the asked capability', repairedSolicitingSkuCapabilityReply);
  assert(!repairedSolicitingSkuCapabilityReply.includes('需要的话告诉我具体需求'), 'repaired SKU capability answer must not ask for concrete demands during a capability question', repairedSolicitingSkuCapabilityReply);
  assert(!repairedSolicitingSkuCapabilityReply.includes('要展示哪些规格组合'), 'repaired SKU capability answer must not ask which specs to display during a capability question', repairedSolicitingSkuCapabilityReply);
  assert(!repairedSolicitingSkuCapabilityReply.includes('特殊备注'), 'repaired SKU capability answer must not ask for special notes during a capability question', repairedSolicitingSkuCapabilityReply);
  assert(!repairedSolicitingSkuCapabilityReply.includes('我可以帮你规划视觉方案'), 'repaired SKU capability answer must not end with a generic planning solicitation', repairedSolicitingSkuCapabilityReply);

  let repeatedSolicitationCallCount = 0;
  const sanitizedRepeatedSolicitationReply = await conversational.tryConversationalModelReply(
    {
      userInput: '你会做SKU吗',
      conversationHistory: [],
      isPluginConnected: true,
      photoshopContext: { hasDocument: true, documentName: 'SKU.psb', layerCount: 16 },
      projectContext: { projectPath: 'C:/project/C-1163', projectImageCount: 9 }
    },
    async () => {
      repeatedSolicitationCallCount += 1;
      return {
        text: repeatedSolicitationCallCount === 1
          ? '当然可以帮你处理SKU相关的设计需求。比如袜子项目的SKU组合图、规格备注图这些，需要的话告诉我具体需求，比如要展示哪些规格组合或特殊备注。'
          : '能做，SKU 这块我会按组合图和自选备注来理解；需要的话告诉我具体规格组合或特殊备注。'
      };
    }
  );
  assert(repeatedSolicitationCallCount === 2, 'repeated SKU capability solicitation should run one repair attempt before sanitizing model text', { repeatedSolicitationCallCount, sanitizedRepeatedSolicitationReply });
  assert(sanitizedRepeatedSolicitationReply.includes('SKU'), 'sanitized repeated solicitation should keep the model-authored capability answer', sanitizedRepeatedSolicitationReply);
  assert(!sanitizedRepeatedSolicitationReply.includes('需要的话'), 'sanitized repeated solicitation must remove execution-detail prompts', sanitizedRepeatedSolicitationReply);
  assert(!sanitizedRepeatedSolicitationReply.includes('具体规格组合'), 'sanitized repeated solicitation must remove specific spec prompts', sanitizedRepeatedSolicitationReply);

  let broaderSolicitationCallCount = 0;
  const sanitizedBroaderSolicitationReply = await conversational.tryConversationalModelReply(
    {
      userInput: '你会做SKU吗',
      conversationHistory: [],
      isPluginConnected: true,
      photoshopContext: { hasDocument: true, documentName: 'SKU.psb', layerCount: 16 },
      projectContext: { projectPath: 'C:/project/C-1163', projectImageCount: 9 }
    },
    async () => {
      broaderSolicitationCallCount += 1;
      return {
        text: broaderSolicitationCallCount === 1
          ? '可以的，SKU 我能理解组合图和自选备注这类需求。你可以把规格、颜色和备注告诉我，我再帮你规划。'
          : '可以，SKU 组合图和自选备注这类我能理解并协助处理。如果要开始，请告诉我规格、颜色和备注。'
      };
    }
  );
  assert(broaderSolicitationCallCount === 2, 'broader SKU capability solicitation should repair once before sanitizing model-authored text', { broaderSolicitationCallCount, sanitizedBroaderSolicitationReply });
  assert(sanitizedBroaderSolicitationReply.includes('SKU'), 'sanitized broader solicitation should keep the model-authored SKU answer', sanitizedBroaderSolicitationReply);
  assert(sanitizedBroaderSolicitationReply.includes('自选备注'), 'sanitized broader solicitation should keep the asked SKU capability scope', sanitizedBroaderSolicitationReply);
  assert(!sanitizedBroaderSolicitationReply.includes('告诉我规格'), 'sanitized broader solicitation must remove execution input prompts', sanitizedBroaderSolicitationReply);
  assert(!sanitizedBroaderSolicitationReply.includes('我再帮你规划'), 'sanitized broader solicitation must remove planning follow-up prompts', sanitizedBroaderSolicitationReply);
  assert(!sanitizedBroaderSolicitationReply.includes('如果要开始'), 'sanitized broader solicitation must remove start-execution prompts', sanitizedBroaderSolicitationReply);

  let broaderProcessTailCallCount = 0;
  const sanitizedBroaderProcessTailReply = await conversational.tryConversationalModelReply(
    {
      userInput: '你会做SKU吗',
      conversationHistory: [],
      isPluginConnected: true,
      photoshopContext: { hasDocument: true, documentName: 'SKU.psb', layerCount: 16 },
      projectContext: { projectPath: 'C:/project/C-1163', projectImageCount: 9 }
    },
    async () => {
      broaderProcessTailCallCount += 1;
      return {
        text: broaderProcessTailCallCount === 1
          ? '会的，SKU 我可以处理组合图、自选备注、颜色组合和规格备注。具体你想做哪种 SKU 图，可以告诉我素材、规格和颜色，我再判断。'
          : '会，SKU 组合图、自选备注和规格备注这些我能理解。要做的话，直接说素材、规格、颜色和数量，我再进入处理流程。'
      };
    }
  );
  assert(broaderProcessTailCallCount === 2, 'broader SKU process-tail answer should repair once before sanitizing model-authored text', { broaderProcessTailCallCount, sanitizedBroaderProcessTailReply });
  assert(sanitizedBroaderProcessTailReply.includes('SKU'), 'sanitized broader process-tail answer should keep SKU capability scope', sanitizedBroaderProcessTailReply);
  assert(sanitizedBroaderProcessTailReply.includes('自选备注'), 'sanitized broader process-tail answer should keep self-select note capability scope', sanitizedBroaderProcessTailReply);
  assert(!sanitizedBroaderProcessTailReply.includes('具体你想做'), 'sanitized broader process-tail answer must remove execution-choice questions', sanitizedBroaderProcessTailReply);
  assert(!sanitizedBroaderProcessTailReply.includes('直接说素材'), 'sanitized broader process-tail answer must remove direct execution prompts', sanitizedBroaderProcessTailReply);
  assert(!sanitizedBroaderProcessTailReply.includes('我再进入处理流程'), 'sanitized broader process-tail answer must remove process-entry promises', sanitizedBroaderProcessTailReply);

  let naturalProcessingCapabilityCallCount = 0;
  const naturalProcessingCapabilityReply = await conversational.tryConversationalModelReply(
    {
      userInput: '你会做SKU吗',
      conversationHistory: [],
      isPluginConnected: true,
      photoshopContext: { hasDocument: true, documentName: 'SKU.psb', layerCount: 16 },
      projectContext: { projectPath: 'C:/project/C-1163', projectImageCount: 9 }
    },
    async () => {
      naturalProcessingCapabilityCallCount += 1;
      return {
        text: '可以，SKU 组合图、自选备注和规格备注这类内容我能理解并处理。'
      };
    }
  );
  assert(naturalProcessingCapabilityCallCount === 1, 'natural SKU capability answer with "处理" should not need repair', { naturalProcessingCapabilityCallCount, naturalProcessingCapabilityReply });
  assert(naturalProcessingCapabilityReply.includes('SKU'), 'natural processing capability answer should keep SKU scope', naturalProcessingCapabilityReply);
  assert(naturalProcessingCapabilityReply.includes('自选备注'), 'natural processing capability answer should keep self-select note scope', naturalProcessingCapabilityReply);
  assert(!naturalProcessingCapabilityReply.includes('暂时没有拿到可靠'), 'natural processing capability answer should not become unavailable', naturalProcessingCapabilityReply);

  let directProcessingCapabilityCallCount = 0;
  const directProcessingCapabilityReply = await conversational.tryConversationalModelReply(
    {
      userInput: '你会做SKU吗',
      conversationHistory: [],
      isPluginConnected: true,
      photoshopContext: { hasDocument: true, documentName: 'SKU.psb', layerCount: 16 },
      projectContext: { projectPath: 'C:/project/C-1163', projectImageCount: 9 }
    },
    async () => {
      directProcessingCapabilityCallCount += 1;
      return {
        text: '可以，我可以处理 SKU 组合图、自选备注和规格备注。'
      };
    }
  );
  assert(directProcessingCapabilityCallCount === 1, 'direct natural SKU capability answer with "我可以处理" should not need repair', { directProcessingCapabilityCallCount, directProcessingCapabilityReply });
  assert(directProcessingCapabilityReply.includes('SKU'), 'direct processing capability answer should keep SKU scope', directProcessingCapabilityReply);
  assert(directProcessingCapabilityReply.includes('自选备注'), 'direct processing capability answer should keep self-select note scope', directProcessingCapabilityReply);
  assert(!directProcessingCapabilityReply.includes('暂时没有拿到可靠'), 'direct processing capability answer should not become unavailable', directProcessingCapabilityReply);

  let planningPromiseCapabilityCallCount = 0;
  const repairedPlanningPromiseSkuCapabilityReply = await conversational.tryConversationalModelReply(
    {
      userInput: '你会做SKU吗',
      conversationHistory: [],
      isPluginConnected: true,
      photoshopContext: { hasDocument: true, documentName: 'SKU.psb', layerCount: 16 },
      projectContext: { projectPath: 'C:/project/C-1163', projectImageCount: 9 }
    },
    async () => {
      planningPromiseCapabilityCallCount += 1;
      if (planningPromiseCapabilityCallCount === 1) {
        return {
          text: '我可以为你制作SKU组合图、规格备注图并处理素材导出。制作时我会读取项目的素材和模板配置，为你规划并生成符合要求的视觉方案。'
        };
      }
      return {
        text: NATURAL_SKU_CAPABILITY_REPLY
      };
    }
  );

  assert(planningPromiseCapabilityCallCount === 2, 'SKU capability answer with generic planning promises should be repaired once', { planningPromiseCapabilityCallCount, repairedPlanningPromiseSkuCapabilityReply });
  assert(repairedPlanningPromiseSkuCapabilityReply.includes('SKU'), 'repaired planning-promise SKU answer should still answer the asked capability', repairedPlanningPromiseSkuCapabilityReply);
  assert(!repairedPlanningPromiseSkuCapabilityReply.includes('我可以帮你规划视觉方案'), 'repaired SKU capability answer must not keep generic visual-plan promises', repairedPlanningPromiseSkuCapabilityReply);
  assert(!repairedPlanningPromiseSkuCapabilityReply.includes('为你制作SKU组合图'), 'repaired SKU capability answer must not shift capability chat into an execution promise', repairedPlanningPromiseSkuCapabilityReply);
  assert(!repairedPlanningPromiseSkuCapabilityReply.includes('处理素材导出'), 'repaired SKU capability answer must not turn capability chat into a broad execution promise', repairedPlanningPromiseSkuCapabilityReply);
  assert(!repairedPlanningPromiseSkuCapabilityReply.includes('生成符合要求的视觉方案'), 'repaired SKU capability answer must not promise generated visual plans during a capability question', repairedPlanningPromiseSkuCapabilityReply);

  let visualPlanSolicitationCallCount = 0;
  const repairedVisualPlanSolicitationReply = await conversational.tryConversationalModelReply(
    {
      userInput: '你会做SKU吗',
      conversationHistory: [],
      isPluginConnected: true,
      photoshopContext: { hasDocument: true, documentName: 'SKU.psb', layerCount: 16 },
      projectContext: { projectPath: 'C:/project/C-1163', projectImageCount: 9 }
    },
    async () => {
      visualPlanSolicitationCallCount += 1;
      if (visualPlanSolicitationCallCount === 1) {
        return {
          text: '可以帮你设计袜子SKU的视觉方案，包括组合图、规格备注和导出素材。具体需要哪种类型的视觉呈现？'
        };
      }
      return {
        text: NATURAL_SKU_CAPABILITY_REPLY
      };
    }
  );

  assert(visualPlanSolicitationCallCount === 2, 'SKU capability answer with visual-plan solicitation should be repaired once', { visualPlanSolicitationCallCount, repairedVisualPlanSolicitationReply });
  assert(repairedVisualPlanSolicitationReply.includes('SKU'), 'repaired visual-plan SKU answer should still answer the asked capability', repairedVisualPlanSolicitationReply);
  assert(!repairedVisualPlanSolicitationReply.includes('视觉方案'), 'repaired SKU capability answer must not frame the answer as a visual-plan offer', repairedVisualPlanSolicitationReply);
  assert(!repairedVisualPlanSolicitationReply.includes('具体需要哪种类型'), 'repaired SKU capability answer must not ask for execution choices during a capability question', repairedVisualPlanSolicitationReply);
  assert(!repairedVisualPlanSolicitationReply.includes('导出素材'), 'repaired SKU capability answer must not promise exports during a capability question', repairedVisualPlanSolicitationReply);

  let genericInputSolicitationCallCount = 0;
  const repairedGenericInputSolicitationReply = await conversational.tryConversationalModelReply(
    {
      userInput: '你会做SKU吗',
      conversationHistory: [],
      isPluginConnected: true,
      photoshopContext: { hasDocument: true, documentName: 'SKU.psb', layerCount: 16 },
      projectContext: { projectPath: 'C:/project/C-1163', projectImageCount: 9 }
    },
    async (_messages, options = {}) => {
      genericInputSolicitationCallCount += 1;
      if (options.purpose === 'direct_response_repair') {
        return {
          text: NATURAL_SKU_CAPABILITY_REPLY
        };
      }
      return {
        text: '请补充具体目标、要处理的图层和想达到的效果。'
      };
    }
  );

  assert(genericInputSolicitationCallCount === 2, 'generic capability input solicitation should be repaired once instead of accepted as the answer', { genericInputSolicitationCallCount, repairedGenericInputSolicitationReply });
  assert(repairedGenericInputSolicitationReply === NATURAL_SKU_CAPABILITY_REPLY, 'repaired generic input solicitation should keep the model-authored repair answer', repairedGenericInputSolicitationReply);
  assert(!repairedGenericInputSolicitationReply.includes('请补充具体目标'), 'repaired generic input solicitation must not ask for generic execution inputs', repairedGenericInputSolicitationReply);
  assert(!repairedGenericInputSolicitationReply.includes('图层'), 'repaired generic input solicitation must not ask for layers during a SKU capability question', repairedGenericInputSolicitationReply);
  assert(!repairedGenericInputSolicitationReply.includes('效果'), 'repaired generic input solicitation must not ask for effects during a SKU capability question', repairedGenericInputSolicitationReply);

  let capturedHistoryFilteredMessages = [];
  const historyFilteredCapabilityReply = await conversational.tryConversationalModelReply(
    {
      userInput: '你会做SKU吗',
      conversationHistory: [
        { role: 'user', content: '你会做SKU吗' },
        {
          role: 'assistant',
          content: '我可以为你制作SKU组合图、规格备注图并处理素材导出。制作时我会读取项目的素材和模板配置，为你规划并生成符合要求的视觉方案。'
        }
      ],
      isPluginConnected: true,
      photoshopContext: { hasDocument: true, documentName: 'SKU.psb', layerCount: 16 },
      projectContext: { projectPath: 'C:/project/C-1163', projectImageCount: 9 }
    },
    async (messages) => {
      capturedHistoryFilteredMessages = messages;
      return {
        text: NATURAL_SKU_CAPABILITY_REPLY
      };
    }
  );
  const serializedHistoryFilteredMessages = JSON.stringify(capturedHistoryFilteredMessages);
  assert(historyFilteredCapabilityReply.includes('SKU'), 'history-filtered capability reply should still answer SKU', historyFilteredCapabilityReply);
  assert(!serializedHistoryFilteredMessages.includes('处理素材导出'), 'bad capability history must not be sent back into the model prompt', serializedHistoryFilteredMessages);
  assert(!serializedHistoryFilteredMessages.includes('生成符合要求的视觉方案'), 'bad visual-plan capability history must not contaminate the next prompt', serializedHistoryFilteredMessages);

  let capturedGreetingFilteredMessages = [];
  const greetingAfterPollutedCapabilityHistory = await conversational.tryConversationalModelReply(
    {
      userInput: '你好',
      conversationHistory: [
        { role: 'user', content: '你会做SKU吗' },
        {
          role: 'assistant',
          content: '你好！我是你的电商视觉设计搭档。 关于你刚才问的 SKU 制作，这正是我擅长的领域。我可以帮你处理以下几类工作： 1. SKU 组合图生成：根据你提供的单品素材，自动生成不同规格（如单双、多双装）的组合排版。 2. 自选备注图制作：针对电商常见的“自选备注”需求，我可以按照 2-3-4 双等规格批量生成对应的备注说明图。 3. 规格标准化导出：统一调整素材的大小、位置和背景，确保全套 SKU 视觉风格一致。 你可以直接告诉我你目前的素材情况（比如有几款颜色、几种规格）以及想要的排版样式，我先为你规划一套出图方案。如果你有参考图，也可以发给我。'
        }
      ],
      isPluginConnected: true,
      photoshopContext: { hasDocument: true, documentName: 'SKU.psb', layerCount: 16 },
      projectContext: { projectPath: 'C:/project/C-1163', projectImageCount: 9 }
    },
    async (messages) => {
      capturedGreetingFilteredMessages = messages;
      return { text: '你好，我在。' };
    }
  );
  const serializedGreetingFilteredMessages = JSON.stringify(capturedGreetingFilteredMessages);
  assert(greetingAfterPollutedCapabilityHistory === '你好，我在。', 'greeting should keep the model-authored conversational reply', greetingAfterPollutedCapabilityHistory);
  assert(!serializedGreetingFilteredMessages.includes('以下几类工作'), 'polluted SKU capability menu must not contaminate greeting prompt history', serializedGreetingFilteredMessages);
  assert(!serializedGreetingFilteredMessages.includes('你可以直接告诉我你目前的素材情况'), 'polluted SKU next-step prompt must not contaminate greeting prompt history', serializedGreetingFilteredMessages);

  let qualityPromiseCapabilityCallCount = 0;
  const repairedQualityPromiseSkuCapabilityReply = await conversational.tryConversationalModelReply(
    {
      userInput: '你会做SKU吗',
      conversationHistory: [],
      isPluginConnected: true,
      photoshopContext: { hasDocument: true, documentName: 'SKU.psb', layerCount: 16 },
      projectContext: { projectPath: 'C:/project/C-1163', projectImageCount: 9 }
    },
    async () => {
      qualityPromiseCapabilityCallCount += 1;
      if (qualityPromiseCapabilityCallCount === 1) {
        return {
          text: '我可以制作 SKU 组合图，并能处理自选备注信息的排版与导出，确保输出的规格图符合你的设计要求。'
        };
      }
      return {
        text: NATURAL_SKU_CAPABILITY_REPLY
      };
    }
  );

  assert(qualityPromiseCapabilityCallCount === 2, 'SKU capability answer with unverified quality guarantees should be repaired once', { qualityPromiseCapabilityCallCount, repairedQualityPromiseSkuCapabilityReply });
  assert(repairedQualityPromiseSkuCapabilityReply.includes('SKU'), 'repaired quality-promise SKU answer should still answer the asked capability', repairedQualityPromiseSkuCapabilityReply);
  assert(!repairedQualityPromiseSkuCapabilityReply.includes('确保输出'), 'repaired SKU capability answer must not guarantee unverified output quality', repairedQualityPromiseSkuCapabilityReply);
  assert(!repairedQualityPromiseSkuCapabilityReply.includes('符合你的设计要求'), 'repaired SKU capability answer must not promise final quality before execution and review', repairedQualityPromiseSkuCapabilityReply);

  let productionPromiseCapabilityCallCount = 0;
  const repairedProductionPromiseSkuCapabilityReply = await conversational.tryConversationalModelReply(
    {
      userInput: '你会做SKU吗',
      conversationHistory: [],
      isPluginConnected: true,
      photoshopContext: { hasDocument: true, documentName: 'SKU.psb', layerCount: 16 },
      projectContext: { projectPath: 'C:/project/C-1163', projectImageCount: 9 }
    },
    async () => {
      productionPromiseCapabilityCallCount += 1;
      if (productionPromiseCapabilityCallCount === 1) {
        return {
          text: '我可以为你制作SKU组合图和规格组合，也能处理像“2双装”、“3双装”这类规格对应的自选备注图生成与素材导出。在实际制作时，我会直接读取当前项目的素材配置和模板信息来高效完成。'
        };
      }
      return {
        text: NATURAL_SKU_CAPABILITY_REPLY
      };
    }
  );

  assert(productionPromiseCapabilityCallCount === 2, 'SKU capability answer with direct production/export promises should be repaired once', { productionPromiseCapabilityCallCount, repairedProductionPromiseSkuCapabilityReply });
  assert(repairedProductionPromiseSkuCapabilityReply.includes('SKU'), 'repaired production-promise SKU answer should still answer the asked capability', repairedProductionPromiseSkuCapabilityReply);
  assert(!repairedProductionPromiseSkuCapabilityReply.includes('为你制作SKU组合图'), 'repaired SKU capability answer must not keep direct production promises', repairedProductionPromiseSkuCapabilityReply);
  assert(!repairedProductionPromiseSkuCapabilityReply.includes('素材导出'), 'repaired SKU capability answer must not promise exports in capability chat', repairedProductionPromiseSkuCapabilityReply);
  assert(!repairedProductionPromiseSkuCapabilityReply.includes('高效完成'), 'repaired SKU capability answer must not promise completion before execution', repairedProductionPromiseSkuCapabilityReply);

  let invalidCapabilityRepairCallCount = 0;
  const invalidRepairSkuCapabilityReply = await conversational.tryConversationalModelReplyDetailed(
    {
      userInput: '你会做SKU吗',
      conversationHistory: [],
      isPluginConnected: true,
      photoshopContext: { hasDocument: true, documentName: 'SKU.psb', layerCount: 16 },
      projectContext: { projectPath: 'C:/project/C-1163', projectImageCount: 9 }
    },
    async () => {
      invalidCapabilityRepairCallCount += 1;
      return {
        text: invalidCapabilityRepairCallCount === 1
          ? '我可以为你制作SKU组合图和规格组合，也能处理自选备注图生成与素材导出。'
          : '实际制作时我会直接读取当前项目的素材配置和模板信息来高效完成。'
      };
    }
  );

  assert(invalidCapabilityRepairCallCount === 2, 'invalid SKU capability answer should run one repair attempt before failing closed', { invalidCapabilityRepairCallCount, invalidRepairSkuCapabilityReply });
  assert(
    invalidRepairSkuCapabilityReply.reply === null
      && invalidRepairSkuCapabilityReply.failure?.kind === 'rejected_by_cleaner'
      && invalidRepairSkuCapabilityReply.failure?.attempts?.some((attempt) => attempt.purpose === 'direct_response_repair' && attempt.status === 'rejected'),
    'invalid SKU capability repairs must not synthesize local fixed capability speech after the model fails the cleaner twice',
    invalidRepairSkuCapabilityReply
  );

  let genericCapabilityMenuCallCount = 0;
  const repairedGenericCapabilityMenuReply = await conversational.tryConversationalModelReply(
    {
      userInput: '你会做SKU吗',
      conversationHistory: [],
      isPluginConnected: true,
      photoshopContext: { hasDocument: true, documentName: 'SKU.psb', layerCount: 16 },
      projectContext: { projectPath: 'C:/project/C-1163', projectImageCount: 9 }
    },
    async () => {
      genericCapabilityMenuCallCount += 1;
      if (genericCapabilityMenuCallCount === 1) {
        return {
          text: '我能帮你完成主图、点击图、转化图、白底图、SKU 组合图和自选备注、详情页长图这些设计任务；你可以直接告诉我需要哪一项，我会先判断后进入处理流程。'
        };
      }
      return {
        text: NATURAL_SKU_CAPABILITY_REPLY
      };
    }
  );

  assert(genericCapabilityMenuCallCount === 2, 'generic cross-domain capability menu should be rejected and repaired once', { genericCapabilityMenuCallCount, repairedGenericCapabilityMenuReply });
  assert(repairedGenericCapabilityMenuReply.includes('SKU'), 'repaired generic capability menu should still answer SKU', repairedGenericCapabilityMenuReply);
  assert(!repairedGenericCapabilityMenuReply.includes('主图'), 'repaired generic capability menu must not mention unrelated main-image capability', repairedGenericCapabilityMenuReply);
  assert(!repairedGenericCapabilityMenuReply.includes('详情页'), 'repaired generic capability menu must not mention unrelated detail-page capability', repairedGenericCapabilityMenuReply);
  assert(!repairedGenericCapabilityMenuReply.includes('处理流程'), 'repaired generic capability menu must avoid workflow-menu suffixes', repairedGenericCapabilityMenuReply);

  let unrelatedCapabilityCallCount = 0;
  const repairedUnrelatedCapabilityReply = await conversational.tryConversationalModelReply(
    {
      userInput: '你会做SKU吗',
      conversationHistory: [],
      isPluginConnected: true,
      photoshopContext: { hasDocument: true, documentName: 'SKU.psb', layerCount: 16 },
      projectContext: { projectPath: 'C:/project/C-1163', projectImageCount: 9 }
    },
    async () => {
      unrelatedCapabilityCallCount += 1;
      if (unrelatedCapabilityCallCount === 1) {
        return {
          text: '会做，SKU 组合图和自选备注都可以处理，也可以顺带帮你做详情页设计。'
        };
      }
      return {
        text: NATURAL_SKU_CAPABILITY_REPLY
      };
    }
  );

  assert(unrelatedCapabilityCallCount === 2, 'specific capability answer must be repaired if it drifts into unrelated capabilities', { unrelatedCapabilityCallCount, repairedUnrelatedCapabilityReply });
  assert(repairedUnrelatedCapabilityReply.includes('SKU'), 'repaired unrelated-capability answer should still answer SKU', repairedUnrelatedCapabilityReply);
  assert(!repairedUnrelatedCapabilityReply.includes('详情页'), 'repaired SKU capability answer must not mention unrelated detail-page capability', repairedUnrelatedCapabilityReply);
  assert(!repairedUnrelatedCapabilityReply.includes('主图'), 'repaired SKU capability answer must not mention unrelated main-image capability', repairedUnrelatedCapabilityReply);

  const skuCapabilityProviderFailureReply = await conversational.tryConversationalModelReply(
    {
      userInput: '你会做SKU吗',
      conversationHistory: [],
      isPluginConnected: true,
      photoshopContext: { hasDocument: true, documentName: 'SKU.psb', layerCount: 16 },
      projectContext: { projectPath: 'C:/project/C-1163', projectImageCount: 9 }
    },
    async () => {
      throw new Error('401 invalid api key');
    }
  );

  assert(
    skuCapabilityProviderFailureReply === null,
    'provider-failure conversational reply should return null so the engine can render ui_status instead of fixed assistant speech',
    skuCapabilityProviderFailureReply
  );

  let capturedProjectPrompt = '';
  await conversational.tryConversationalModelReply(
    {
      userInput: '帮我看看当前项目有什么素材',
      conversationHistory: [],
      isPluginConnected: true,
      photoshopContext: { hasDocument: true, documentName: 'demo.psd', layerCount: 8 },
      projectContext: { projectPath: 'C:/project/C-1160', projectImageCount: 6 }
    },
    async (messages, options) => {
      capturedProjectPrompt = String(messages?.[0]?.content || '');
      assert(options?.purpose === 'direct_response', 'project-context conversational reply should stay direct_response', options);
      return { text: '我可以先按项目素材结构做只读梳理，再总结素材类型。' };
    }
  );

  assert(capturedProjectPrompt.includes('当前项目可参考 6 张图片'), 'project-focused chat should include scoped project image count', capturedProjectPrompt);
  assert(capturedProjectPrompt.includes('当前项目中已扫描到 6 张图片'), 'project-focused chat should include the project image analysis hint', capturedProjectPrompt);
  assert(capturedProjectPrompt.includes('只能陈述已确认的数量'), 'project-focused chat should include a boundary against inferring project category or SKU config', capturedProjectPrompt);
}

async function run() {
  runSharedContractChecks();
  await runConversationalIntegrationChecks();
  console.log(JSON.stringify({
    success: true,
    checks: [
      'response knowledge bundle keeps persona, capability, project and preference facts structured',
      'active explicit preferences enter response context',
      'inferred, disabled and deprecated preferences are excluded from active response preferences',
      'unsafe knowledge cannot become response context',
      'response knowledge renders as designer-facing guidance instead of internal contract labels',
      'response knowledge includes SKU domain terminology without hardcoded reply text',
      'response knowledge keeps thinking owned by the agent while tools stay defined execution capabilities',
      'conversational prompt receives the designer-facing response knowledge without Photoshop execution',
      'plan-only detail-page document prompts keep SKU as material source instead of an added deliverable',
      'plan-only structured design plans are allowed without being mistaken for canned capability menus',
      'old canned capability menu replies are rejected and repaired into natural answers',
      'formulaic SKU capability explainers are rejected and repaired into focused answers',
      'SKU capability answers that solicit execution details are repaired into direct capability answers',
      'SKU capability answers with generic planning promises are repaired into direct capability answers',
      'SKU capability answers with visual-plan solicitation are repaired into direct capability answers',
      'invalid capability reply history is filtered before the next model prompt',
      'SKU capability answers with unverified quality guarantees are repaired',
      'SKU capability answers with direct production/export promises are repaired',
      'repeated invalid SKU capability repairs fail closed instead of synthesizing fixed local speech',
      'unsupported current-project facts are rejected and invalid project-fact history is filtered',
      'provider failures report model availability instead of fixed deliverable menus'
    ]
  }, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
