#!/usr/bin/env node

const fs = require('fs');
const net = require('net');
const path = require('path');
const { _electron: electron } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const REPORT_JSON = path.join(ROOT, 'tmp', 'chat-ui-electron-bridge-smoke.json');
const REPORT_MD = path.join(ROOT, 'tmp', 'chat-ui-electron-bridge-smoke.md');
const WS_PORT = 8765;
const TEST_PORT_START = 18765;
const TEST_PORT_END = 19765;
const debugState = {
  stage: 'not-started',
  lastMessages: [],
  lastText: ''
};

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function isPortOpen(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host });
    socket.setTimeout(500);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => resolve(false));
  });
}

async function findFreePortBlock(start = TEST_PORT_START, end = TEST_PORT_END, count = 4) {
  for (let base = start; base <= end - count; base += count + 1) {
    const checks = [];
    for (let offset = 0; offset < count; offset += 1) {
      checks.push(isPortOpen(base + offset));
    }
    const open = await Promise.all(checks);
    if (open.every((value) => !value)) return base;
  }
  throw new Error(`No free ${count}-port block found between ${start} and ${end}.`);
}

function resetTestUserDataDir() {
  const tmpRoot = path.resolve(ROOT, 'tmp');
  const userDataDir = path.resolve(tmpRoot, 'chat-ui-electron-bridge-user-data');
  if (!userDataDir.startsWith(`${tmpRoot}${path.sep}`)) {
    throw new Error(`Refusing to remove unsafe test userData directory: ${userDataDir}`);
  }
  fs.rmSync(userDataDir, { recursive: true, force: true });
  fs.mkdirSync(userDataDir, { recursive: true });
  return userDataDir;
}

function resetTestProjectDir() {
  const tmpRoot = path.resolve(ROOT, 'tmp');
  const projectDir = path.resolve(tmpRoot, 'chat-ui-electron-bridge-project');
  if (!projectDir.startsWith(`${tmpRoot}${path.sep}`)) {
    throw new Error(`Refusing to remove unsafe test project directory: ${projectDir}`);
  }
  fs.rmSync(projectDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(projectDir, '素材'), { recursive: true });
  fs.mkdirSync(path.join(projectDir, 'PSD'), { recursive: true });
  fs.mkdirSync(path.join(projectDir, '输出'), { recursive: true });
  return projectDir;
}

function writeReports(result) {
  fs.mkdirSync(path.dirname(REPORT_JSON), { recursive: true });
  fs.writeFileSync(REPORT_JSON, JSON.stringify(result, null, 2), 'utf8');
  fs.writeFileSync(
    REPORT_MD,
    [
      '# Chat UI Electron Bridge Smoke',
      '',
      `- success: ${result.success}`,
      `- skipped: ${!!result.skipped}`,
      result.reason ? `- reason: ${result.reason}` : '',
      `- report: ${REPORT_JSON}`,
      '',
      '## Checks',
      ...(result.checks || []).map((check) => `- ${check}`)
    ].filter(Boolean).join('\n'),
    'utf8'
  );
}

function findLeakedInternalMarkers(text) {
  const markers = [
    'Agent 面板桥接消息已生成',
    '"intent": "debug_or_implement"',
    '"current_state"',
    '"action_request"',
    'expected_feedback',
    'Pondering'
  ];
  return markers.filter((marker) => text.includes(marker));
}

function findDetailPageExecutionMarkers(text) {
  const markers = [
    '详情页已部分执行完成',
    '详情页模板解析失败',
    '模板评估',
    '屏规划',
    '放图风险',
    '先检查当前详情页模板结构',
    '正在新建详情页文档',
    '执行填充',
    'recover-then-fill'
  ];
  return markers.filter((marker) => text.includes(marker));
}

function messagesText(messages) {
  return messages.map((message) => message.contentPreview).join('\n');
}

function messagesBlockTitles(messages) {
  return messages.flatMap((message) => Array.isArray(message.thinkingBlockTitles) ? message.thinkingBlockTitles : []);
}

function hasToolProcessBlock(titles) {
  return titles.includes('执行记录') || titles.includes('工具调用');
}

async function main() {
  debugState.stage = 'launching';
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const mainEntry = path.join(ROOT, pkg.main || 'dist/main/main/index.js');
  const rendererEntry = path.join(ROOT, 'dist/renderer/index.html');

  assert(fs.existsSync(mainEntry), `Missing built Electron main entry: ${mainEntry}. Run npm run build first.`);
  assert(fs.existsSync(rendererEntry), `Missing built renderer entry: ${rendererEntry}. Run npm run build first.`);

  const defaultWsPortWasOpen = await isPortOpen(WS_PORT);
  const testPortBase = await findFreePortBlock();
  const testUserDataDir = resetTestUserDataDir();
  const testProjectDir = resetTestProjectDir();

  let app;
  try {
    app = await electron.launch({
      args: [ROOT, `--user-data-dir=${testUserDataDir}`],
      cwd: ROOT,
      env: {
        ...process.env,
        DESIGNECHO_CHAT_TEST_BRIDGE: '1',
        DESIGNECHO_TEST_USER_DATA_DIR: testUserDataDir,
        DESIGNECHO_CHAT_TEST_PROJECT_PATH: testProjectDir,
        DESIGNECHO_CHAT_TEST_FAKE_MODEL: '1',
        DESIGNECHO_CHAT_TEST_FAKE_MODEL_FIXTURE: 'chat-ui-electron-bridge',
        DESIGNECHO_CHAT_TEST_FAKE_PHOTOSHOP: '1',
        DESIGNECHO_PORT_OFFSET: String(testPortBase - WS_PORT),
        DESIGNECHO_SKIP_PORT_CLEANUP: '1',
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
      },
      timeout: 30000
    });

    const page = await app.firstWindow({ timeout: 30000 });
    debugState.stage = 'renderer-loading';
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() => !!window.__DESIGNECHO_CHAT_TEST_BRIDGE__, null, { timeout: 30000 });

    const selectors = await page.evaluate(() => ({
      input: !!document.querySelector('[data-testid="chat-input"]'),
      send: !!document.querySelector('[data-testid="chat-send"]'),
      messages: !!document.querySelector('[data-testid="chat-messages"]'),
      bridge: !!window.__DESIGNECHO_CHAT_TEST_BRIDGE__,
      query: window.location.search
    }));

    assert(selectors.input, 'chat input test selector is missing');
    assert(selectors.send, 'chat send test selector is missing');
    assert(selectors.messages, 'chat messages test selector is missing');
    assert(selectors.bridge, 'chat test bridge is unavailable');
    assert(String(selectors.query).includes('designechoChatTestBridge=1'), 'renderer query did not enable the test bridge');
    assert(String(selectors.query).includes('designechoChatTestFakePhotoshop=1'), 'renderer query did not enable fake Photoshop for the smoke test');

    debugState.stage = 'help';
    const before = await page.evaluate(() => window.__DESIGNECHO_CHAT_TEST_BRIDGE__.getSnapshot());
    const after = await page.evaluate(() => window.__DESIGNECHO_CHAT_TEST_BRIDGE__.submit('/help', { timeoutMs: 8000 }));
    const visibleText = messagesText(after.messages);
    const newMessages = after.messages.slice(before.messageCount);
    const leakedInternalMarkers = findLeakedInternalMarkers(visibleText);

    assert(after.messageCount >= before.messageCount + 2, 'submitting /help should append user and assistant messages');
    assert(visibleText.includes('/help'), 'visible chat snapshot should include submitted /help command');
    assert(visibleText.includes('可用命令'), 'visible chat snapshot should include assistant help response');
    assert(newMessages.some((message) => message.role === 'user' && message.contentPreview.includes('/help')), 'new messages should include the submitted user command');
    assert(newMessages.some((message) => message.role === 'assistant' && message.contentPreview.includes('可用命令')), 'new messages should include the deterministic assistant help response');
    assert(newMessages.every((message) => message.thinkingStepCount === 0), '/help should not create fake thinking or tool progress steps');
    assert(messagesBlockTitles(newMessages).length === 0, '/help should not render thinking/log block titles');
    assert(leakedInternalMarkers.length === 0, `visible chat snapshot leaked internal debug markers: ${leakedInternalMarkers.join(', ')}`);

    debugState.stage = 'identity';
    const beforeIdentity = after;
    const identityPrompt = '我的意思是你是什么模型，不是执行任务';
    const afterIdentity = await page.evaluate((prompt) => (
      window.__DESIGNECHO_CHAT_TEST_BRIDGE__.submit(prompt, { timeoutMs: 12000 })
    ), identityPrompt);
    const identityMessages = afterIdentity.messages.slice(beforeIdentity.messageCount);
    const identityText = messagesText(identityMessages);
    debugState.lastMessages = identityMessages;
    debugState.lastText = identityText;
    const identityLeaks = findLeakedInternalMarkers(identityText);
    const blockedExecutionPhrases = [
      '当前没有打开的 Photoshop 文档',
      '读取当前文档',
      '读取文档信息',
      '先检查当前详情页模板结构',
      '正在新建详情页文档',
      'Agent 面板桥接消息已生成'
    ].filter((phrase) => identityText.includes(phrase));

    assert(afterIdentity.messageCount >= beforeIdentity.messageCount + 2, 'model identity chat should append user and assistant messages');
    assert(identityMessages.some((message) => message.role === 'user' && message.contentPreview.includes(identityPrompt)), 'identity sample should include the submitted user prompt');
    assert(!identityText.includes('测试模型响应'), 'identity sample must not expose fake-model debug wording');
    assert(!identityText.includes('普通对话'), 'identity sample must not expose route-classification wording');
    assert(identityMessages.some((message) => message.role === 'assistant' && /DesignEcho|对话模型/.test(message.contentPreview) && /不(?:读取|改动画面)/.test(message.contentPreview)), 'identity sample should be treated as natural conversational intent');
    assert(identityMessages.some((message) => (
      message.role === 'assistant'
      && message.assistantReplyOrigin?.origin === 'test_fixture'
      && message.assistantReplyOrigin?.userVisibleKind === 'test_fixture'
    )), 'identity sample should be marked as a fake-model test fixture, not production model speech');
    assert(identityMessages.every((message) => message.thinkingStepCount === 0), 'identity chat should not render fake thinking steps');
    assert(messagesBlockTitles(identityMessages).length === 0, 'identity chat should not render 正在思考 or 执行记录 blocks without provider thinking/tool evidence');
    assert(identityMessages.every((message) => message.toolResultCount === 0), 'identity chat should not render tool result steps');
    assert(identityLeaks.length === 0, `identity chat leaked internal debug markers: ${identityLeaks.join(', ')}`);
    assert(blockedExecutionPhrases.length === 0, `identity chat looked like a Photoshop execution path: ${blockedExecutionPhrases.join(', ')}`);

    debugState.stage = 'ordinary-chat';
    const beforeOrdinaryChat = afterIdentity;
    const ordinaryChatPrompt = '为什么电商详情页要分屏设计？';
    const afterOrdinaryChat = await page.evaluate((prompt) => (
      window.__DESIGNECHO_CHAT_TEST_BRIDGE__.submit(prompt, { timeoutMs: 12000 })
    ), ordinaryChatPrompt);
    const ordinaryChatMessages = afterOrdinaryChat.messages.slice(beforeOrdinaryChat.messageCount);
    const ordinaryChatText = messagesText(ordinaryChatMessages);
    debugState.lastMessages = ordinaryChatMessages;
    debugState.lastText = ordinaryChatText;
    const ordinaryChatLeaks = findLeakedInternalMarkers(ordinaryChatText);
    const ordinaryChatExecutionPhrases = [
      '当前没有打开的 Photoshop 文档',
      '读取当前文档',
      '读取文档信息',
      '先检查当前详情页模板结构',
      '正在新建详情页文档',
      '执行工具'
    ].filter((phrase) => ordinaryChatText.includes(phrase));

    assert(afterOrdinaryChat.messageCount >= beforeOrdinaryChat.messageCount + 2, 'ordinary chat should append user and assistant messages');
    assert(ordinaryChatMessages.some((message) => message.role === 'user' && message.contentPreview.includes(ordinaryChatPrompt)), 'ordinary chat sample should include the submitted user prompt');
    assert(!ordinaryChatText.includes('测试模型响应'), 'ordinary chat sample must not expose fake-model debug wording');
    assert(!ordinaryChatText.includes('普通对话'), 'ordinary chat sample must not expose route-classification wording');
    assert(ordinaryChatMessages.some((message) => message.role === 'assistant' && /详情页分屏|信息层级/.test(message.contentPreview)), 'ordinary chat sample should be treated as natural conversational intent');
    assert(ordinaryChatMessages.some((message) => (
      message.role === 'assistant'
      && message.assistantReplyOrigin?.origin === 'test_fixture'
      && message.assistantReplyOrigin?.userVisibleKind === 'test_fixture'
    )), 'ordinary chat sample should be marked as a fake-model test fixture, not production model speech');
    assert(ordinaryChatMessages.every((message) => message.thinkingStepCount === 0), 'ordinary chat should not render fake thinking steps');
    assert(messagesBlockTitles(ordinaryChatMessages).length === 0, 'ordinary chat should not render 正在思考 or 执行记录 blocks without provider thinking/tool evidence');
    assert(ordinaryChatMessages.every((message) => message.toolResultCount === 0), 'ordinary chat should not render tool result steps');
    assert(ordinaryChatLeaks.length === 0, `ordinary chat leaked internal debug markers: ${ordinaryChatLeaks.join(', ')}`);
    assert(ordinaryChatExecutionPhrases.length === 0, `ordinary chat looked like a Photoshop execution path: ${ordinaryChatExecutionPhrases.join(', ')}`);

    debugState.stage = 'close-document';
    const beforeCloseDocument = afterOrdinaryChat;
    const closeDocumentPrompt = '帮我关闭文档不保存';
    const afterCloseDocument = await page.evaluate((prompt) => (
      window.__DESIGNECHO_CHAT_TEST_BRIDGE__.submit(prompt, { timeoutMs: 16000 })
    ), closeDocumentPrompt);
    const closeDocumentMessages = afterCloseDocument.messages.slice(beforeCloseDocument.messageCount);
    const closeDocumentText = messagesText(closeDocumentMessages);
    debugState.lastMessages = closeDocumentMessages;
    debugState.lastText = closeDocumentText;
    const closeDocumentThinkingText = closeDocumentMessages.map((message) => message.thinkingPreview || '').join('\n');
    const closeDocumentBlockTitles = messagesBlockTitles(closeDocumentMessages);
    const closeDocumentLeaks = findLeakedInternalMarkers(closeDocumentText);
    const closeDocumentDetailMarkers = findDetailPageExecutionMarkers(closeDocumentText);

    assert(afterCloseDocument.messageCount >= beforeCloseDocument.messageCount + 2, 'close document sample should append user and assistant messages');
    assert(closeDocumentMessages.some((message) => message.role === 'user' && message.contentPreview.includes(closeDocumentPrompt)), 'close document sample should include the submitted user prompt');
    assert(closeDocumentMessages.some((message) => message.role === 'assistant' && message.contentPreview.includes('已关闭文档')), 'close document sample should report that the document was closed');
    assert(closeDocumentMessages.some((message) => message.role === 'assistant' && message.contentPreview.includes('未保存')), 'close document sample should preserve save=false semantics');
    assert(closeDocumentThinkingText.includes('closeDocument') || closeDocumentThinkingText.includes('关闭文档'), 'close document sample should expose real closeDocument tool calls');
    assert(hasToolProcessBlock(closeDocumentBlockTitles), 'close document telemetry should render as 执行记录');
    assert(!closeDocumentBlockTitles.includes('执行日志'), 'close document telemetry must not render generic execution-log blocks');
    assert(!closeDocumentBlockTitles.includes('正在思考'), 'close document telemetry must not render as provider thinking');
    assert(closeDocumentLeaks.length === 0, `close document sample leaked internal debug markers: ${closeDocumentLeaks.join(', ')}`);
    assert(closeDocumentDetailMarkers.length === 0, `close document sample routed to detail-page execution markers: ${closeDocumentDetailMarkers.join(', ')}`);

    debugState.stage = 'save-document';
    const beforeSaveDocument = afterCloseDocument;
    const saveDocumentPrompt = '帮我把详情页文档保存到项目的PSD中';
    const afterSaveDocument = await page.evaluate((prompt) => (
      window.__DESIGNECHO_CHAT_TEST_BRIDGE__.submit(prompt, { timeoutMs: 16000 })
    ), saveDocumentPrompt);
    const saveDocumentMessages = afterSaveDocument.messages.slice(beforeSaveDocument.messageCount);
    const saveDocumentText = messagesText(saveDocumentMessages);
    debugState.lastMessages = saveDocumentMessages;
    debugState.lastText = saveDocumentText;
    const saveDocumentThinkingText = saveDocumentMessages.map((message) => message.thinkingPreview || '').join('\n');
    const saveDocumentBlockTitles = messagesBlockTitles(saveDocumentMessages);
    const saveDocumentLeaks = findLeakedInternalMarkers(saveDocumentText);
    const saveDocumentDetailMarkers = findDetailPageExecutionMarkers(saveDocumentText);

    assert(afterSaveDocument.messageCount >= beforeSaveDocument.messageCount + 2, 'save document sample should append user and assistant messages');
    assert(saveDocumentMessages.some((message) => message.role === 'user' && message.contentPreview.includes(saveDocumentPrompt)), 'save document sample should include the submitted user prompt');
    assert(saveDocumentMessages.some((message) => message.role === 'assistant' && message.contentPreview.includes('已保存当前文档')), 'save document sample should report that the current document was saved');
    assert(saveDocumentMessages.some((message) => message.role === 'assistant' && message.contentPreview.includes('PSD')), 'save document sample should preserve project PSD destination semantics');
    assert(saveDocumentThinkingText.includes('saveDocument') || saveDocumentThinkingText.includes('保存文档'), 'save document sample should expose real saveDocument tool calls');
    assert(hasToolProcessBlock(saveDocumentBlockTitles), 'save document telemetry should render as 执行记录');
    assert(!saveDocumentBlockTitles.includes('执行日志'), 'save document telemetry must not render generic execution-log blocks');
    assert(!saveDocumentBlockTitles.includes('正在思考'), 'save document telemetry must not render as provider thinking');
    assert(saveDocumentLeaks.length === 0, `save document sample leaked internal debug markers: ${saveDocumentLeaks.join(', ')}`);
    assert(saveDocumentDetailMarkers.length === 0, `save document sample routed to detail-page execution markers: ${saveDocumentDetailMarkers.join(', ')}`);

    debugState.stage = 'failed-acceptance';
    const beforeFailedAcceptance = afterSaveDocument;
    const failedAcceptancePrompt = '请根据当前画面做一版更高级的设计，并制造验收失败报告样本，不要伪装完成';
    const afterFailedAcceptance = await page.evaluate((prompt) => (
      window.__DESIGNECHO_CHAT_TEST_BRIDGE__.submit(prompt, { timeoutMs: 20000 })
    ), failedAcceptancePrompt);
    const failedAcceptanceMessages = afterFailedAcceptance.messages.slice(beforeFailedAcceptance.messageCount);
    const failedAcceptanceText = messagesText(failedAcceptanceMessages);
    debugState.lastMessages = failedAcceptanceMessages;
    debugState.lastText = failedAcceptanceText;
    const failedAcceptanceBlockTitles = messagesBlockTitles(failedAcceptanceMessages);
    const failedAcceptanceLeaks = findLeakedInternalMarkers(failedAcceptanceText);
    const failedAcceptanceSummaryOrPreflightBlocked = failedAcceptanceMessages.some((message) => {
      if (message.role !== 'assistant') {
        return false;
      }
      const summary = String(message.executionSummaryPreview || '');
      const content = String(message.contentPreview || '');
      const userVisibleState = message.agentUserVisibleState || {};
      const assistantReplyOrigin = message.assistantReplyOrigin || {};
      return summary.includes('验收失败 1 项')
        || summary.includes('工具执行前置检查未通过')
        || (
          userVisibleState.category === 'planning'
          && userVisibleState.toolUse === 'no_tools'
          && assistantReplyOrigin.userVisibleKind === 'blocker_notice'
        )
        || content.includes('工具决策契约未通过')
        || content.includes('agent_tool_decision_contract_blocked');
    });
    const failedAcceptanceExecutionFailed = failedAcceptanceMessages.some((message) => (
      message.role === 'assistant'
      && message.executionStatus === 'failed'
      && message.executionSummaryPreview?.includes('执行状态：未完成')
    ));

    assert(afterFailedAcceptance.messageCount >= beforeFailedAcceptance.messageCount + 2, 'failed acceptance sample should append user and assistant messages');
    assert(failedAcceptanceMessages.some((message) => message.role === 'user' && message.contentPreview.includes(failedAcceptancePrompt)), 'failed acceptance sample should include the submitted user prompt');
    assert(failedAcceptanceExecutionFailed || failedAcceptanceSummaryOrPreflightBlocked, `failed acceptance sample should expose either failed execution summary or planning/preflight blocker: ${JSON.stringify(failedAcceptanceMessages).slice(0, 800)}`);
    assert(!failedAcceptanceText.includes('错误:'), 'failed acceptance sample must not expose raw error labels');
    assert(!failedAcceptanceBlockTitles.includes('执行日志'), 'failed acceptance telemetry must not render generic execution-log blocks');
    assert(!failedAcceptanceMessages.some((message) => String(message.thinkingPreview || '').includes('已完成并验证。')), 'failed acceptance optimistic completion must not render as provider thinking');
    assert(!failedAcceptanceText.includes('已完成并验证。'), 'failed acceptance sample must not expose the model optimistic completion as final answer');
    assert(failedAcceptanceLeaks.length === 0, `failed acceptance sample leaked internal debug markers: ${failedAcceptanceLeaks.join(', ')}`);

    const result = {
      success: true,
      skipped: false,
      defaultWsPortWasOpen,
      isolatedPorts: {
        ws: testPortBase,
        webview: testPortBase + 1,
        debugBridge: testPortBase + 2,
        mcpHost: testPortBase + 3
      },
      testUserDataDir,
      testProjectDir,
      checks: [
        'Electron app launched with DESIGNECHO_CHAT_TEST_BRIDGE=1 using isolated userData',
        'Renderer opened a disposable test project so the real ChatPanel mounted',
        'Electron smoke used isolated ports and did not touch the normal 8765 Agent/UXP bridge',
        'ChatPanel test bridge was exposed only through injected query',
        'stable chat input/send/messages selectors exist',
        'bridge submit(/help) appended user and assistant messages',
        'visible message snapshot contains the expected help response',
        'deterministic /help response did not render fake thinking/tool progress',
        'deterministic /help response did not render thinking/log block titles',
        'model identity question used the controlled model chat path',
        'model identity question did not trigger Photoshop document reads or execution wording',
        'model identity question did not render fake thinking/tool progress or Pondering block titles',
        'ordinary design chat question used the controlled model chat path',
        'fake-model conversational samples were marked as test fixtures instead of production model speech',
        'ordinary design chat question did not trigger Photoshop execution wording',
        'ordinary design chat question did not render fake thinking/tool progress or Pondering block titles',
        'close-document-without-saving sample used document-management and preserved save=false',
        'document operation telemetry rendered as 执行记录 instead of 正在思考',
        'save-detail-page-document-to-project-PSD sample used document-management instead of detail-page execution',
        'document operation samples used fake Photoshop only inside the isolated test bridge',
        'failed acceptance sample rendered executionSummary failed state or structured planning/preflight blocker instead of optimistic model completion',
        'visible snapshot did not expose internal debug bridge JSON markers'
      ],
      beforeMessageCount: before.messageCount,
      afterHelpMessageCount: after.messageCount,
      afterIdentityMessageCount: afterIdentity.messageCount,
      afterOrdinaryChatMessageCount: afterOrdinaryChat.messageCount,
      afterCloseDocumentMessageCount: afterCloseDocument.messageCount,
      afterSaveDocumentMessageCount: afterSaveDocument.messageCount,
      afterMessageCount: afterFailedAcceptance.messageCount,
      report: {
        json: REPORT_JSON,
        md: REPORT_MD
      }
    };
    writeReports(result);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    if (app) {
      await app.close().catch(() => undefined);
    }
  }
}

main().catch((error) => {
  const result = {
    success: false,
    error: error?.message || String(error),
    debug: {
      stage: debugState.stage,
      lastText: debugState.lastText,
      lastMessages: debugState.lastMessages
    },
    report: {
      json: REPORT_JSON,
      md: REPORT_MD
    }
  };
  writeReports(result);
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
});
