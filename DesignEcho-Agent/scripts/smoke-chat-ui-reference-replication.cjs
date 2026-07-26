#!/usr/bin/env node

const fs = require('fs');
const net = require('net');
const path = require('path');
const { _electron: electron } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const SMOKE_CASE = process.env.DESIGNECHO_REFERENCE_REPLICATION_SMOKE_CASE === 'neutral-text-layout'
  ? 'neutral-text-layout'
  : 'fex-text-layout';
const CASE_CONFIG = {
  'fex-text-layout': {
    fakeModelCase: 'fex-text-layout',
    referenceImage: 'benchmarks/reference-replication/assets/fex-certificate-text-layout.jpg',
    expectedCoverage: 11,
    imageType: 'image/jpeg',
    prompt: '参考图照着做生成同款版式，保持可编辑文本层',
    forbiddenVisibleText: null,
    reportSlug: 'chat-ui-reference-replication-smoke',
    userDataSlug: 'chat-ui-reference-replication-user-data',
    projectSlug: 'chat-ui-reference-replication-project',
    label: 'temporary FEX text-layout reference image',
    expectedReviewBoundary: false,
    expectedPosterDelivery: false
  },
  'neutral-text-layout': {
    fakeModelCase: 'neutral-text-layout',
    referenceImage: 'benchmarks/reference-replication/assets/neutral-quality-card-text-layout.png',
    expectedCoverage: 9,
    imageType: 'image/png',
    prompt: '参考这张详情页做海报，生成同款版式，保持可编辑文本层',
    forbiddenVisibleText: '品牌:FEX',
    reportSlug: 'chat-ui-reference-replication-neutral-smoke',
    userDataSlug: 'chat-ui-reference-replication-neutral-user-data',
    projectSlug: 'chat-ui-reference-replication-neutral-project',
    label: 'neutral simple text-layout reference image',
    expectedReviewBoundary: true,
    expectedPosterDelivery: true
  }
}[SMOKE_CASE];
const REPORT_JSON = path.join(ROOT, 'tmp', `${CASE_CONFIG.reportSlug}.json`);
const REPORT_MD = path.join(ROOT, 'tmp', `${CASE_CONFIG.reportSlug}.md`);
const WS_PORT = 8765;
const TEST_PORT_START = 19780;
const TEST_PORT_END = 20780;

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

function writeReports(result) {
  fs.mkdirSync(path.dirname(REPORT_JSON), { recursive: true });
  fs.writeFileSync(REPORT_JSON, JSON.stringify(result, null, 2), 'utf8');
  fs.writeFileSync(
    REPORT_MD,
    [
      '# Chat UI Reference Replication Smoke',
      '',
      `- success: ${result.success}`,
      result.error ? `- error: ${result.error}` : '',
      `- report: ${REPORT_JSON}`,
      '',
      '## Checks',
      ...(result.checks || []).map((check) => `- ${check}`)
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

function findInternalMarkers(text) {
  return [
    'Agent 面板桥接消息已生成',
    '"intent": "debug_or_implement"',
    '"current_state"',
    '"action_request"',
    'expected_feedback',
    'Max iterations reached',
    '达到最大迭代次数'
  ].filter((marker) => text.includes(marker));
}

async function main() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const mainEntry = path.join(ROOT, pkg.main || 'dist/main/main/index.js');
  const rendererEntry = path.join(ROOT, 'dist/renderer/index.html');
  const referenceImagePath = path.join(ROOT, CASE_CONFIG.referenceImage);

  assert(fs.existsSync(mainEntry), `Missing built Electron main entry: ${mainEntry}. Run npm run build first.`);
  assert(fs.existsSync(rendererEntry), `Missing built renderer entry: ${rendererEntry}. Run npm run build first.`);
  assert(fs.existsSync(referenceImagePath), `Missing reference image fixture: ${referenceImagePath}`);

  const defaultWsPortWasOpen = await isPortOpen(WS_PORT);
  const testPortBase = await findFreePortBlock();
  const userDataDir = resetDir(CASE_CONFIG.userDataSlug);
  const projectDir = resetDir(CASE_CONFIG.projectSlug);
  fs.mkdirSync(path.join(projectDir, 'PSD'), { recursive: true });
  fs.mkdirSync(path.join(projectDir, '素材'), { recursive: true });

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
        DESIGNECHO_CHAT_TEST_REFERENCE_CASE: CASE_CONFIG.fakeModelCase,
        DESIGNECHO_CHAT_TEST_FAKE_PHOTOSHOP: '1',
        DESIGNECHO_CHAT_TEST_FAKE_PHOTOSHOP_EMPTY: '1',
        DESIGNECHO_PORT_OFFSET: String(testPortBase - WS_PORT),
        DESIGNECHO_SKIP_PORT_CLEANUP: '1',
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
      },
      timeout: 30000
    });

    const page = await app.firstWindow({ timeout: 30000 });
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() => !!window.__DESIGNECHO_CHAT_TEST_BRIDGE__, null, { timeout: 30000 });

    const before = await page.evaluate(() => window.__DESIGNECHO_CHAT_TEST_BRIDGE__.getSnapshot());
    const imageData = fs.readFileSync(referenceImagePath).toString('base64');
    const prompt = CASE_CONFIG.prompt;
    const after = await page.evaluate((payload) => (
      window.__DESIGNECHO_CHAT_TEST_BRIDGE__.submit(payload.prompt, {
        image: { data: payload.imageData, type: payload.imageType },
        timeoutMs: 45000
      })
    ), { prompt, imageData, imageType: CASE_CONFIG.imageType });
    const newMessages = after.messages.slice(before.messageCount);
    const visibleText = messagesText(newMessages);
    const progressText = thinkingText(newMessages);
    const internalMarkers = findInternalMarkers(`${visibleText}\n${progressText}`);

    assert(after.messageCount >= before.messageCount + 2, 'reference replication sample should append user and assistant messages');
    assert(newMessages.some((message) => message.role === 'user' && message.contentPreview.includes(prompt)), 'submitted prompt should appear in chat snapshot');
    assert(newMessages.some((message) => message.role === 'user' && message.hasImage), 'submitted reference image should be attached to the user message');
    assert(/参考图|复刻|骨架/.test(visibleText), `assistant response should describe reference replication result: ${visibleText}`);
    assert(/可编辑/.test(visibleText), `assistant response should mention editable output boundary: ${visibleText}`);
    assert(!/失败\/跳过操作/.test(visibleText), `reference replication should not report dependency-gate failures: ${visibleText}`);
    assert(!/画布快照未完成|缺少画布快照|未取得(?:可用的)?画布快照/.test(visibleText), `reference replication must not pass without snapshot evidence: ${visibleText}`);
    assert(
      new RegExp(`元素覆盖:\\s*${CASE_CONFIG.expectedCoverage}\\/${CASE_CONFIG.expectedCoverage}`).test(visibleText),
      `reference replication should cover every ${CASE_CONFIG.label} element: ${visibleText}\nProgress:\n${progressText}`
    );
    if (CASE_CONFIG.forbiddenVisibleText) {
      assert(!visibleText.includes(CASE_CONFIG.forbiddenVisibleText), `neutral reference smoke must not expose FEX fixture content: ${visibleText}`);
    }
    if (CASE_CONFIG.expectedReviewBoundary) {
      assert(/需复核/.test(visibleText), `neutral text-layout smoke should remain a review-grade result, not a completed high-fidelity claim: ${visibleText}`);
      assert(/不能判定为高保真复刻/.test(visibleText), `neutral text-layout smoke should state the high-fidelity boundary: ${visibleText}`);
      assert(!/阻断项:|bounds 不匹配|参考图复刻未完成/.test(visibleText), `neutral text envelope drift should not be reported as a hard blocker: ${visibleText}`);
    }
    if (CASE_CONFIG.expectedPosterDelivery) {
      assert(/交付结构:\s*海报（单画布）/.test(visibleText), `detail-page reference must deliver a single-canvas poster: ${visibleText}`);
      assert(/根图层组:\s*海报复刻骨架/.test(visibleText), `poster delivery should retain the poster root-group identity: ${visibleText}`);
      assert(!/详情页(?:模板|复刻)?骨架|交付物身份校验未通过/.test(visibleText), `poster delivery must not inherit a detail-page skeleton: ${visibleText}`);
    }
    assert(/识别到|分析参考图|提取版式结构|可编辑骨架|analyzeReferenceLayout|生成模板骨架/.test(progressText), `thinking progress should reflect layout-replication flow: ${progressText}`);
    assert(/读取画布快照/.test(progressText), `thinking progress should include a completed canvas snapshot readback: ${progressText}`);
    assert(!/: error/.test(progressText), `layout-replication UI progress should not contain tool errors: ${progressText}`);
    assert(internalMarkers.length === 0, `visible UI leaked internal or max-iteration markers: ${internalMarkers.join(', ')}`);
    assert(!/普通对话/.test(visibleText), `reference replication should not fall back to ordinary chat: ${visibleText}`);

    const result = {
      success: true,
      defaultWsPortWasOpen,
      isolatedPorts: {
        ws: testPortBase,
        webview: testPortBase + 1,
        debugBridge: testPortBase + 2,
        mcpHost: testPortBase + 3
      },
      checks: [
        'Electron ChatPanel launched with isolated test bridge',
        `${CASE_CONFIG.label} was submitted through the real ChatPanel image path`,
        'controlled layout-replication entered the autonomous ReAct loop instead of ordinary chat',
        'fake vision model returned strict reference-parse JSON to the real layout-replication executor',
        'fake Photoshop empty-document path exercised createDocument and editable text-layer creation flow',
        'explicit layerIds avoided false selectLayer dependency failures during grouping',
        `visible result covered all ${CASE_CONFIG.expectedCoverage} ${CASE_CONFIG.label} elements`,
        ...(CASE_CONFIG.expectedPosterDelivery
          ? ['detail-page reference wording produced a single-canvas poster and never a detail-page skeleton']
          : []),
        'visible UI did not expose internal bridge JSON or max-iteration wording'
        + (CASE_CONFIG.expectedReviewBoundary ? '; neutral text envelope drift stayed review-grade instead of hard-blocked' : '')
      ],
      beforeMessageCount: before.messageCount,
      afterMessageCount: after.messageCount,
      assistantPreview: visibleText.slice(0, 1200),
      thinkingPreview: progressText.slice(0, 1200),
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
