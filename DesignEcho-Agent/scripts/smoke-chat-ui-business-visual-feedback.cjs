#!/usr/bin/env node

const fs = require('fs');
const net = require('net');
const path = require('path');
const { _electron: electron } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const REPORT_JSON = path.join(ROOT, 'tmp', 'chat-ui-business-visual-feedback-smoke.json');
const REPORT_MD = path.join(ROOT, 'tmp', 'chat-ui-business-visual-feedback-smoke.md');
const REFERENCE_IMAGE = path.join(
  ROOT,
  'benchmarks',
  'reference-replication',
  'assets',
  'neutral-quality-card-text-layout.png'
);
const WS_PORT = 8765;
const TEST_PORT_START = 23920;
const TEST_PORT_END = 24920;

const PSEUDO_THINKING_MARKERS = [
  '等待响应',
  '请求已发送',
  '正在准备',
  '正在思考',
  '稍等，正在准备处理你的需求'
];

const USER_VISIBLE_TECHNICAL_MARKERS = [
  '图像证据',
  '截图证据',
  '视觉证据',
  'pixel-probe',
  'bounds 级',
  '位置框 级',
  'benchmark case'
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
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
    const open = await Promise.all(Array.from({ length: count }, (_, index) => isPortOpen(base + index)));
    if (open.every((value) => !value)) return base;
  }
  throw new Error(`No free ${count}-port block found between ${start} and ${end}.`);
}

function resetDir(name) {
  const tmpRoot = path.resolve(ROOT, 'tmp');
  const dir = path.resolve(tmpRoot, name);
  if (!dir.startsWith(`${tmpRoot}${path.sep}`)) {
    throw new Error(`Refusing to remove unsafe test directory: ${dir}`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function resetProjectDir() {
  const projectDir = resetDir('chat-ui-business-visual-feedback-project');
  fs.mkdirSync(path.join(projectDir, 'PSD'), { recursive: true });
  fs.mkdirSync(path.join(projectDir, '素材'), { recursive: true });
  fs.mkdirSync(path.join(projectDir, '输出'), { recursive: true });
  return projectDir;
}

function writeReports(result) {
  fs.mkdirSync(path.dirname(REPORT_JSON), { recursive: true });
  fs.writeFileSync(REPORT_JSON, JSON.stringify(result, null, 2), 'utf8');
  fs.writeFileSync(
    REPORT_MD,
    [
      '# Chat UI Business Visual Feedback Smoke',
      '',
      `- success: ${result.success}`,
      result.error ? `- error: ${result.error}` : '',
      `- report: ${REPORT_JSON}`,
      '',
      '## Checks',
      ...(result.checks || []).map((check) => `- ${check}`),
      '',
      '## Boundaries',
      ...(result.boundaries || []).map((boundary) => `- ${boundary}`)
    ].filter(Boolean).join('\n'),
    'utf8'
  );
}

function messagesText(messages) {
  return messages.map((message) => message.contentPreview || '').join('\n');
}

function thinkingText(messages) {
  return messages.map((message) => message.thinkingPreview || '').join('\n');
}

function collectTitles(messages, fieldName) {
  return messages.flatMap((message) => Array.isArray(message[fieldName]) ? message[fieldName] : []);
}

async function main() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const mainEntry = path.join(ROOT, pkg.main || 'dist/main/main/index.js');
  const rendererEntry = path.join(ROOT, 'dist', 'renderer', 'index.html');

  assert(fs.existsSync(mainEntry), `Missing built Electron main entry: ${mainEntry}. Run npm run build first.`);
  assert(fs.existsSync(rendererEntry), `Missing built renderer entry: ${rendererEntry}. Run npm run build first.`);
  assert(fs.existsSync(REFERENCE_IMAGE), `Missing reference image fixture: ${REFERENCE_IMAGE}`);

  const defaultWsPortWasOpen = await isPortOpen(WS_PORT);
  const testPortBase = await findFreePortBlock();
  const userDataDir = resetDir('chat-ui-business-visual-feedback-user-data');
  const projectDir = resetProjectDir();
  let app;

  try {
    app = await electron.launch({
      args: [ROOT, `--user-data-dir=${userDataDir}`],
      cwd: ROOT,
      env: {
        ...process.env,
        DESIGNECHO_CHAT_TEST_BRIDGE: '1',
        DESIGNECHO_TEST_USER_DATA_DIR: userDataDir,
        DESIGNECHO_CHAT_TEST_PROJECT_PATH: projectDir,
        DESIGNECHO_CHAT_TEST_FAKE_MODEL: '1',
        DESIGNECHO_CHAT_TEST_REFERENCE_CASE: 'neutral-text-layout',
        DESIGNECHO_CHAT_TEST_FAKE_PHOTOSHOP: '1',
        DESIGNECHO_CHAT_TEST_FAKE_PHOTOSHOP_EMPTY: '1',
        DESIGNECHO_PORT_OFFSET: String(testPortBase - WS_PORT),
        DESIGNECHO_SKIP_PORT_CLEANUP: '1',
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
      },
      timeout: 30000
    });

    const page = await app.firstWindow({ timeout: 30000 });
    await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
    await page.waitForFunction(() => !!window.__DESIGNECHO_CHAT_TEST_BRIDGE__, null, { timeout: 30000 });

    const before = await page.evaluate(() => window.__DESIGNECHO_CHAT_TEST_BRIDGE__.getSnapshot());
    const imageData = fs.readFileSync(REFERENCE_IMAGE).toString('base64');
    const prompt = '参考图照着做生成同款版式，保持可编辑文本层';
    const after = await page.evaluate((payload) => (
      window.__DESIGNECHO_CHAT_TEST_BRIDGE__.submit(payload.prompt, {
        image: { data: payload.imageData, type: 'image/png' },
        timeoutMs: 50000
      })
    ), { prompt, imageData });

    const newMessages = after.messages.slice(before.messageCount);
    const assistantMessages = newMessages.filter((message) => message.role === 'assistant');
    const visibleText = messagesText(newMessages);
    const progressText = thinkingText(newMessages);
    const cardTitles = collectTitles(assistantMessages, 'cardTitles');
    const thinkingBlockTitles = collectTitles(assistantMessages, 'thinkingBlockTitles');
    const businessPreflightCardTitles = collectTitles(assistantMessages, 'businessPreflightCardTitles');
    const pseudoThinkingLeaks = PSEUDO_THINKING_MARKERS.filter((marker) => (
      visibleText.includes(marker) || progressText.includes(marker) || cardTitles.join('\n').includes(marker)
    ));

    assert(after.messageCount >= before.messageCount + 2, 'business feedback UI sample should append user and assistant messages.');
    assert(newMessages.some((message) => message.role === 'user' && message.hasImage), 'sample should attach the reference image.');
    assert(assistantMessages.length > 0, 'sample should append an assistant message.');
    assert(assistantMessages.some((message) => message.hasBusinessVisualObservationFeedback), 'assistant message should persist businessVisualObservationFeedback.');
    const userVisibleFeedbackMessages = assistantMessages.filter((message) => message.businessVisualObservationFeedbackUserVisible);
    if (userVisibleFeedbackMessages.length > 0) {
      assert(businessPreflightCardTitles.length > 0, 'user-visible businessVisualObservationFeedback should render as a business preflight card.');
      assert(cardTitles.some((title) => title.includes('处理前先确认')), `card titles should include 处理前先确认: ${cardTitles.join(', ')}`);
    } else {
      assert(businessPreflightCardTitles.length === 0, 'hidden businessVisualObservationFeedback should not add user-facing preflight cards.');
      assert(!cardTitles.some((title) => title.includes('处理前先确认')), `hidden feedback should not leak preflight titles: ${cardTitles.join(', ')}`);
    }
    assert(!thinkingBlockTitles.some((title) => title.includes('处理前先确认')), 'business preflight feedback must not render as a thinking block.');
    assert(!thinkingBlockTitles.some((title) => title.includes('等待响应')), 'UI must not replace model thinking with waiting placeholders.');
    assert(pseudoThinkingLeaks.length === 0, `UI leaked pseudo thinking placeholders: ${pseudoThinkingLeaks.join(', ')}`);
    assert(!visibleText.includes('Agent 面板桥接消息已生成'), 'visible assistant reply leaked debug bridge copy.');
    assert(!visibleText.includes('"intent": "debug_or_implement"'), 'visible assistant reply leaked debug JSON.');
    assert(
      USER_VISIBLE_TECHNICAL_MARKERS.every((marker) => !visibleText.includes(marker)),
      `visible assistant reply leaked technical QA wording: ${USER_VISIBLE_TECHNICAL_MARKERS.filter((marker) => visibleText.includes(marker)).join(', ')}`
    );
    assert(/参考图|复刻|骨架/.test(visibleText), `assistant response should remain on reference replication path: ${visibleText}`);

    const result = {
      success: true,
      defaultWsPortWasOpen,
      isolatedPorts: {
        ws: testPortBase,
        webview: testPortBase + 1,
        debugBridge: testPortBase + 2,
        mcpHost: testPortBase + 3
      },
      beforeMessageCount: before.messageCount,
      afterMessageCount: after.messageCount,
      cardTitles,
      thinkingBlockTitles,
      businessPreflightCardTitles,
      businessVisualObservationFeedbackUserVisible: userVisibleFeedbackMessages.length > 0,
      assistantPreview: visibleText.slice(0, 1200),
      thinkingPreview: progressText.slice(0, 1200),
      checks: [
        'Electron ChatPanel launched with isolated userData and isolated ports.',
        'Business visual evidence feedback persisted on the assistant message.',
        'Message parser only renders preflight cards when feedback is user-visible.',
        'Business visual feedback did not enter thinkingBlockTitles.',
        'The UI did not show hardcoded waiting/preparing pseudo-thinking placeholders.',
        'Visible reply did not expose debug bridge JSON.'
      ],
      boundaries: [
        'This smoke uses fake model and fake Photoshop.',
        'It validates ChatPanel rendering and evidence placement only.',
        'It does not prove live provider reasoning, real Photoshop writes, or design quality.'
      ],
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
    error: error?.stack || error?.message || String(error),
    report: {
      json: REPORT_JSON,
      md: REPORT_MD
    }
  };
  writeReports(result);
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
});
