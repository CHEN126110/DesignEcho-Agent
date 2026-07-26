#!/usr/bin/env node

const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const repoRoot = path.resolve(__dirname, '..');

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
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
  buildAgentPreferenceFeedbackMessages,
  normalizeAgentPreferenceFeedbackDecision,
  shouldAttemptPreferenceFeedbackCapture,
  shouldRoutePreferenceFeedbackConversationally
} = require(path.join(repoRoot, 'src', 'shared', 'agent-preference-feedback.ts'));
const { DesignAgentEngine } = require(path.join(repoRoot, 'src', 'renderer', 'services', 'design-agent', 'engine.ts'));
const { getMemoryService } = require(path.join(repoRoot, 'src', 'renderer', 'services', 'memory.service.ts'));
const { buildAgentIntentControlPlaneDecision } = require(path.join(repoRoot, 'src', 'shared', 'agent-intent-control-plane.ts'));
const { resolveAgentProjectMemoryScope } = require(path.join(repoRoot, 'src', 'renderer', 'services', 'agent-orchestration', 'types.ts'));
const { tryConversationalModelReplyDetailed } = require(path.join(repoRoot, 'src', 'renderer', 'services', 'agent-orchestration', 'conversational.ts'));
const { buildDesignMemoryKnowledgeResultsForSkill } = require(path.join(repoRoot, 'src', 'renderer', 'services', 'skill-executors', 'design-planner-context.ts'));

function createContext(userInput) {
  return {
    userInput,
    conversationHistory: [],
    isPluginConnected: true,
    photoshopContext: { hasDocument: true, documentName: 'demo.psd', layerCount: 8 },
    projectContext: { projectPath: 'C:/project/C-1160', projectImageCount: 6 }
  };
}

function runSharedContractChecks() {
  assert(
    shouldAttemptPreferenceFeedbackCapture('以后主图标题我喜欢阿里巴巴普惠体，帮我记住'),
    'explicit preference wording should request preference capture'
  );
  assert(
    !shouldAttemptPreferenceFeedbackCapture('帮我做一张主图'),
    'ordinary execution request should not request preference capture'
  );
  assert(
    shouldRoutePreferenceFeedbackConversationally('以后主图标题我喜欢阿里巴巴普惠体，帮我记住'),
    'explicit memory wording should route to conversation before the router model'
  );
  assert(
    !shouldRoutePreferenceFeedbackConversationally('优先使用已有 SKU 色卡模板，完成后读取导出结果'),
    'business execution priority wording must not become a preference conversation route'
  );
  assert(
    shouldRoutePreferenceFeedbackConversationally('请记住以后默认导出 PNG'),
    'an explicit long-term export preference must not be mistaken for a current export action'
  );
  const currentEditRequest = '我不喜欢这个详情页的文案，帮我重新调整一下';
  assert(
    !shouldAttemptPreferenceFeedbackCapture(currentEditRequest),
    'current detail-page edit feedback must not be captured as a long-term preference'
  );
  assert(
    !shouldRoutePreferenceFeedbackConversationally(currentEditRequest),
    'current detail-page edit feedback must not be swallowed by the preference conversation route'
  );
  const currentEditDecision = buildAgentIntentControlPlaneDecision({
    userInput: currentEditRequest,
    photoshopConnected: true,
    hasDocument: true
  });
  assert(
    currentEditDecision.requestKind !== 'chat_only',
    'current edit feedback must remain available to the normal execution decision path',
    currentEditDecision
  );
  assert(
    !shouldRoutePreferenceFeedbackConversationally('帮我记住以后少用夸张词，并把当前详情页文案重新调整一下'),
    'a mixed remember-and-edit request must not lose its current execution request'
  );

  const messages = buildAgentPreferenceFeedbackMessages({
    userText: '以后主图标题我喜欢阿里巴巴普惠体，帮我记住',
    assistantReply: '已理解，我会按你的偏好处理。'
  });
  const serializedMessages = JSON.stringify(messages);
  assert(serializedMessages.includes('只返回严格 JSON'), 'feedback extraction prompt should require strict JSON', messages);
  assert(serializedMessages.includes('不要输出置信度'), 'feedback extraction prompt should forbid confidence wording', messages);
  assert(serializedMessages.includes('不能从工具参数或猜测中推断'), 'feedback extraction prompt should reject inferred preferences', messages);

  const decision = normalizeAgentPreferenceFeedbackDecision(JSON.stringify({
    shouldSave: true,
    preferences: [
      {
        category: 'font',
        value: '阿里巴巴普惠体',
        label: '主图标题字体偏好',
        sourceNote: '用户明确说以后主图标题喜欢阿里巴巴普惠体。',
        confidence: 0.91
      },
      {
        category: 'unknown',
        value: '随便猜的偏好',
        label: '无效项',
        sourceNote: '模型推断。'
      }
    ],
    confidence: 0.99
  }));

  assert(decision.shouldSave === true, 'explicit preference decision should be saveable', decision);
  assert(decision.preferences.length === 1, 'invalid preference categories should be filtered', decision);
  assert(decision.preferences[0].value === '阿里巴巴普惠体', 'valid preference value should be preserved', decision);
  assert(!JSON.stringify(decision).includes('confidence'), 'normalized preference decision must not expose confidence fields', decision);

  const unsafe = normalizeAgentPreferenceFeedbackDecision(JSON.stringify({
    shouldSave: true,
    preferences: [
      {
        category: 'style',
        value: 'data:image/png;base64,abc',
        label: 'bad',
        sourceNote: 'raw-image-payload'
      }
    ]
  }));
  assert(unsafe.preferences[0].value.includes('[redacted-image-payload]'), 'raw payloads should be redacted', unsafe);
}

async function runEngineIntegrationChecks() {
  const engine = new DesignAgentEngine();
  const memory = getMemoryService();
  let callModelCount = 0;
  let sawPreferenceFeedbackPurpose = false;

  const result = await engine.run(createContext('以后主图标题我喜欢阿里巴巴普惠体，帮我记住这个偏好'), {
    callModel: async (_messages, options) => {
      callModelCount += 1;
      if (options?.purpose === 'preference_feedback') {
        sawPreferenceFeedbackPurpose = true;
        return {
          text: JSON.stringify({
            shouldSave: true,
            preferences: [{
              category: 'font',
              value: '阿里巴巴普惠体',
              label: '主图标题字体偏好',
              sourceNote: '用户明确说以后主图标题喜欢阿里巴巴普惠体。'
            }]
          })
        };
      }
      const systemPrompt = String(_messages?.[0]?.content || '');
      if (systemPrompt.includes('intent router')) {
        return {
          text: JSON.stringify({
            route: 'direct_response',
            directResponse: '我会按这个明确偏好处理后续主图标题字体。',
            intentSummary: '用户明确要求记住一个设计偏好。'
          })
        };
      }
      return { text: '我会按这个明确偏好处理后续主图标题字体。' };
    }
  });

  const items = memory.listPreferenceItems();
  const saved = items.find((item) => item.value === '阿里巴巴普惠体');
  assert(result.success === true, 'conversational preference feedback should still return direct response', result);
  assert(callModelCount === 2, 'explicit preference feedback should use one conversational call and one silent extraction call', { callModelCount });
  assert(sawPreferenceFeedbackPurpose, 'preference extraction model call should use preference_feedback purpose');
  assert(saved, 'explicit preference should be saved to MemoryService', items);
  assert(saved.sourceType === 'explicit', 'saved preference must be explicit', saved);
  assert(saved.status === 'active', 'saved explicit preference must be active', saved);

  let nonPreferenceFeedbackCalls = 0;
  await engine.run(createContext('你会做 SKU 吗？'), {
    callModel: async (_messages, options) => {
      if (options?.purpose === 'preference_feedback') nonPreferenceFeedbackCalls += 1;
      return { text: '可以，但这只是能力询问，不会执行 SKU。' };
    }
  });
  assert(nonPreferenceFeedbackCalls === 0, 'ordinary capability chat should not trigger preference extraction', { nonPreferenceFeedbackCalls });
}

async function runProjectMemoryScopeChecks() {
  const memory = getMemoryService();
  const projectAId = 'scope-smoke-project-a';
  const projectBId = 'scope-smoke-project-b';
  const globalLabel = '范围守卫全局偏好';
  const projectALabel = '范围守卫项目 A 偏好';
  const projectBLabel = '范围守卫项目 B 偏好';

  memory.upsertExplicitPreference({
    category: 'style',
    value: globalLabel,
    label: globalLabel,
    scope: { type: 'user' }
  });
  memory.upsertExplicitPreference({
    category: 'style',
    value: projectALabel,
    label: projectALabel,
    scope: { type: 'project', id: projectAId }
  });
  memory.upsertExplicitPreference({
    category: 'style',
    value: projectBLabel,
    label: projectBLabel,
    scope: { type: 'project', id: projectBId }
  });

  assert(
    JSON.stringify(resolveAgentProjectMemoryScope()).includes('"type":"user"'),
    'missing project context must resolve to user memory scope'
  );
  assert(
    JSON.stringify(resolveAgentProjectMemoryScope({ projectId: projectAId })) === JSON.stringify({ type: 'project', id: projectAId }),
    'active project context must resolve to its stable project memory scope'
  );

  const projectAKnowledge = buildDesignMemoryKnowledgeResultsForSkill({
    userText: '范围守卫 偏好',
    scenario: 'detail-page',
    limit: 30,
    context: { projectContext: { projectId: projectAId } }
  });
  const projectAKnowledgeText = JSON.stringify(projectAKnowledge);
  assert(projectAKnowledgeText.includes(globalLabel), 'project memory context should retain global user preferences', projectAKnowledge);
  assert(projectAKnowledgeText.includes(projectALabel), 'project memory context should include the active project preference', projectAKnowledge);
  assert(!projectAKnowledgeText.includes(projectBLabel), 'design-planner memory must not leak another project preference', projectAKnowledge);

  const userKnowledge = buildDesignMemoryKnowledgeResultsForSkill({
    userText: '范围守卫 偏好',
    scenario: 'detail-page',
    limit: 30
  });
  const userKnowledgeText = JSON.stringify(userKnowledge);
  assert(userKnowledgeText.includes(globalLabel), 'no-project memory context should retain global user preferences', userKnowledge);
  assert(!userKnowledgeText.includes(projectALabel) && !userKnowledgeText.includes(projectBLabel), 'no-project memory context must not read project preferences', userKnowledge);

  let conversationalPrompt = '';
  await tryConversationalModelReplyDetailed({
    userInput: '只说明当前项目可参考的设计偏好，不执行 Photoshop。',
    conversationHistory: [],
    isPluginConnected: true,
    projectContext: { projectId: projectAId, projectName: 'Scope A' }
  }, async (messages) => {
    conversationalPrompt = String(messages?.[0]?.content || '');
    return { text: '当前项目会参考已确认的设计偏好。' };
  });
  assert(conversationalPrompt.includes(globalLabel), 'conversational memory should include global user preferences');
  assert(conversationalPrompt.includes(projectALabel), 'conversational memory should include the active project preference');
  assert(!conversationalPrompt.includes(projectBLabel), 'conversational memory must not leak another project preference');
}

async function run() {
  runSharedContractChecks();
  await runEngineIntegrationChecks();
  await runProjectMemoryScopeChecks();
  console.log(JSON.stringify({
    success: true,
    checks: [
      'explicit preference wording requests silent preference extraction',
      'current edit feedback is not routed or captured as long-term preference memory',
      'preference feedback extraction uses strict JSON and forbids confidence',
      'normalized decisions only keep safe explicit preference categories',
      'direct response can save active explicit preferences through MemoryService',
      'ordinary chat does not trigger preference extraction',
      'conversational and design-planner memory consumers isolate active project scope'
    ]
  }, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
