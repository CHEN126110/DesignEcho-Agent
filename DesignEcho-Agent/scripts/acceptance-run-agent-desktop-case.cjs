#!/usr/bin/env node

const fs = require('fs');
const net = require('net');
const path = require('path');
require('ts-node').register({ transpileOnly: true, project: path.resolve(__dirname, '..', 'tsconfig.main.json') });
const { _electron: electron } = require('playwright');
const {
  formatAgentAcceptanceTriageCasesMarkdown
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-acceptance-triage-report.ts'));

const ROOT = path.resolve(__dirname, '..');
const REPORT_JSON = path.join(ROOT, 'tmp', 'acceptance', 'agent-desktop-acceptance-smoke.json');
const REPORT_MD = path.join(ROOT, 'tmp', 'acceptance', 'agent-desktop-acceptance-smoke.md');
const C1142_REFERENCE_IMAGE = path.join(
  ROOT,
  'benchmarks',
  'reference-replication',
  'assets',
  'neutral-quality-card-text-layout.png'
);
const WS_PORT = 8765;
const TEST_PORT_START = 22840;
const TEST_PORT_END = 23840;

const debugState = {
  stage: 'not-started',
  lastReport: null,
  lastSnapshot: null
};

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
    const checks = [];
    for (let offset = 0; offset < count; offset += 1) {
      checks.push(isPortOpen(base + offset));
    }
    const open = await Promise.all(checks);
    if (open.every((value) => !value)) return base;
  }
  throw new Error('No free ' + count + '-port block found between ' + start + ' and ' + end + '.');
}

function resetDir(name) {
  const tmpRoot = path.resolve(ROOT, 'tmp');
  const dir = path.resolve(tmpRoot, name);
  if (!dir.startsWith(tmpRoot + path.sep)) {
    throw new Error('Refusing to remove unsafe test directory: ' + dir);
  }
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  } catch (error) {
    const code = error && typeof error === 'object' ? error.code : '';
    if (code !== 'EBUSY' && code !== 'ENOTEMPTY' && code !== 'EPERM') throw error;
    const fallbackDir = path.resolve(tmpRoot, `${name}-${process.pid}-${Date.now()}`);
    if (!fallbackDir.startsWith(tmpRoot + path.sep)) {
      throw new Error('Refusing to create unsafe fallback test directory: ' + fallbackDir);
    }
    fs.mkdirSync(fallbackDir, { recursive: true });
    return fallbackDir;
  }
}

function resetTestProjectDir() {
  const projectDir = resetDir('agent-desktop-acceptance-project');
  fs.mkdirSync(path.join(projectDir, 'PSD'), { recursive: true });
  fs.mkdirSync(path.join(projectDir, '素材'), { recursive: true });
  fs.mkdirSync(path.join(projectDir, '输出'), { recursive: true });
  fs.mkdirSync(path.join(projectDir, '模板文件'), { recursive: true });
  fs.mkdirSync(path.join(projectDir, '配置文件'), { recursive: true });
  fs.mkdirSync(path.join(projectDir, 'SKU'), { recursive: true });

  fs.writeFileSync(path.join(projectDir, 'PSD', 'SKU.psb'), 'desktop acceptance fake SKU source', 'utf8');
  fs.writeFileSync(path.join(projectDir, '模板文件', '2双装.psd'), 'desktop acceptance fake 2-pair template', 'utf8');
  fs.writeFileSync(path.join(projectDir, '模板文件', '2双自选备注.psd'), 'desktop acceptance fake 2-pair self-select note template', 'utf8');
  fs.writeFileSync(
    path.join(projectDir, '配置文件', '2色SKU.csv'),
    [
      '模板,配色',
      '2双装.psd,1+2',
      '2双自选备注.psd,1+2'
    ].join('\n'),
    'utf8'
  );
  return projectDir;
}

function applyCaseProjectMutation(projectDir, acceptanceCase) {
  const mutation = acceptanceCase && acceptanceCase.projectMutation;
  if (!mutation) return;
  if (mutation.removeProjectSkuSource) {
    const skuSourcePath = path.join(projectDir, 'PSD', 'SKU.psb');
    if (fs.existsSync(skuSourcePath)) {
      fs.rmSync(skuSourcePath, { force: true });
    }
  }
}

function writeReports(result) {
  const lines = [
    '# Agent Desktop Acceptance Smoke',
    '',
    '- success: ' + result.success,
    result.error ? '- error: ' + result.error : '',
    '- report: ' + REPORT_JSON,
    '',
    '## Cases'
  ];

  for (const item of result.cases || []) {
    lines.push('- ' + item.id + ': ' + item.status + ' | ' + item.summary);
  }

  lines.push('', '## Checks');
  for (const check of result.checks || []) {
    lines.push('- ' + check);
  }

  lines.push('', '## Boundaries');
  for (const item of result.boundaries || []) {
    lines.push('- ' + item);
  }

  lines.push('', formatAgentAcceptanceTriageCasesMarkdown(result.cases || []));

  fs.mkdirSync(path.dirname(REPORT_JSON), { recursive: true });
  fs.writeFileSync(REPORT_JSON, JSON.stringify(result, null, 2), 'utf8');
  fs.writeFileSync(REPORT_MD, lines.filter(Boolean).join('\n'), 'utf8');
}

function buildAcceptanceCases() {
  return [
    {
      id: 'desktop-save-psd-document-management',
      title: '桌面端保存 PSD 请求应走 document-management',
      userInput: '帮我把详情页文档保存到项目的PSD中',
      mode: 'desktop_bridge',
      tags: ['desktop', 'document-management'],
      expectation: {
        route: 'skill_execution',
        routeSource: 'deterministic_route',
        skillId: 'document-management',
        executionKind: 'deterministic_skill',
        shouldUseTools: true,
        shouldChangeDocument: false,
        maxIterations: 1,
        maxToolCalls: 2
      },
      expectedVisibleReasoning: '我先理解这是保存当前 Photoshop 文档的操作'
    },
    {
      id: 'desktop-close-document-no-save',
      title: '桌面端关闭文档不保存请求应走 document-management',
      userInput: '帮我关闭文档不保存',
      mode: 'desktop_bridge',
      tags: ['desktop', 'document-management'],
      expectation: {
        route: 'skill_execution',
        routeSource: 'deterministic_route',
        skillId: 'document-management',
        executionKind: 'deterministic_skill',
        shouldUseTools: true,
        shouldChangeDocument: false,
        maxIterations: 1,
        maxToolCalls: 2
      },
      expectedVisibleReasoning: '我先理解这是关闭当前 Photoshop 文档且不保存的操作'
    },
    {
      id: 'desktop-capability-direct-response',
      title: '桌面端能力问题应直接回答且不执行工具',
      userInput: '你可以做什么？',
      mode: 'desktop_bridge',
      tags: ['desktop', 'direct-response', 'capability'],
      expectation: {
        route: 'direct_response',
        executionKind: 'none',
        shouldUseTools: false,
        shouldChangeDocument: false,
        maxIterations: 0,
        maxToolCalls: 0
      },
      expectedUserVisibleState: {
        category: 'conversation',
        title: '直接回答',
        toolUse: 'no_tools',
        visibleTextIncludes: ['不调用 Photoshop 工具']
      },
      notes: [
        'This case guards capability questions so they do not start Photoshop tools or expose conversational fallback errors.'
      ]
    },
    {
      id: 'desktop-project-inventory-readonly',
      title: '桌面端项目资源概览应走只读检查',
      userInput: '你可以帮我看看这个项目都有什么',
      mode: 'desktop_bridge',
      tags: ['desktop', 'project-inventory', 'read-only'],
      expectation: {
        route: 'skill_execution',
        skillId: 'project-image-analysis',
        executionKind: 'deterministic_skill',
        shouldUseTools: false,
        shouldChangeDocument: false,
        maxIterations: 1,
        maxToolCalls: 0
      },
      expectedUserVisibleState: {
        category: 'read_only',
        title: '只读检查',
        toolUse: 'read_only',
        visibleTextIncludes: ['只读取项目、文档或图层信息']
      },
      notes: [
        'This case guards project inventory requests so they stay metadata/read-only instead of running expensive visual analysis.'
      ]
    },
    {
      id: 'desktop-project-identity-readonly',
      title: '桌面端当前项目问法应走只读项目理解',
      userInput: '当前是什么项目？',
      mode: 'desktop_bridge',
      tags: ['desktop', 'project-identity', 'read-only'],
      expectation: {
        route: 'skill_execution',
        skillId: 'project-image-analysis',
        executionKind: 'deterministic_skill',
        shouldUseTools: false,
        shouldChangeDocument: false,
        maxIterations: 1,
        maxToolCalls: 0
      },
      expectedUserVisibleState: {
        category: 'read_only',
        title: '只读检查',
        toolUse: 'read_only',
        visibleTextIncludes: ['只读取项目、文档或图层信息']
      },
      notes: [
        'This case guards the exact user phrasing seen in C-1166 so project identity questions do not fall back to generic chat or autonomous tools.'
      ]
    },
    {
      id: 'desktop-ambiguous-request-clarification',
      title: '桌面端模糊处理请求应先澄清',
      userInput: '帮我处理一下',
      mode: 'desktop_bridge',
      tags: ['desktop', 'clarification'],
      expectation: {
        route: 'clarification_needed',
        executionKind: 'none',
        shouldUseTools: false,
        shouldChangeDocument: false,
        maxIterations: 0,
        maxToolCalls: 0
      },
      expectedUserVisibleState: {
        category: 'clarification',
        title: '需要补充信息',
        toolUse: 'no_tools',
        visibleTextIncludes: ['目标、动作或交付结果还不够明确']
      },
      notes: [
        'This case guards ambiguous requests so the Agent asks for intent details instead of guessing a tool path.'
      ]
    },
    {
      id: 'desktop-layer-color-order-light-to-dark',
      title: '桌面端图层颜色从浅到深排序请求应走 layer-management',
      userInput: '把图层的颜色从浅到深，从上到下调整图层顺序',
      mode: 'desktop_bridge',
      tags: ['desktop', 'layer-management', 'simple-operation'],
      expectation: {
        route: 'skill_execution',
        routeSource: 'deterministic_route',
        skillId: 'layer-management',
        executionKind: 'deterministic_skill',
        shouldUseTools: true,
        shouldChangeDocument: false,
        maxIterations: 1,
        maxToolCalls: 8
      },
      notes: [
        'This case guards the simple-operation path that should not fall back to a slow autonomous loop.',
        'Fake Photoshop validates route and evidence only; live layer order still requires disposable Photoshop smoke.'
      ],
      expectedUserVisibleState: {
        category: 'blocked',
        title: '当前条件不完整',
        toolUse: 'blocked',
        canStartTools: false,
        userActionRequired: true,
        visibleTextIncludes: ['打开要处理的 Photoshop 文档']
      }
    },
    {
      id: 'desktop-c1142-attached-reference-replication',
      title: '桌面端附图复刻请求应由自主 Agent 调用 layout-replication',
      userInput: '在我们创建的文档中 帮我复刻其中的内容',
      mode: 'desktop_bridge',
      tags: ['desktop', 'reference-replication', 'c1142'],
      imageFixture: C1142_REFERENCE_IMAGE,
      expectedThinkingPattern: 'analyzeReferenceLayout|createTextLayer|工具完成',
      expectation: {
        route: 'autonomous_agent',
        routeSource: 'intent_control_plane',
        skillId: 'autonomous-agent',
        executionKind: 'autonomous_agent',
        shouldUseTools: true,
        shouldChangeDocument: false,
        maxIterations: 4,
        maxToolCalls: 40
      },
      notes: [
        'This case reproduces the C-1142 intent shape with an attached reference image.',
        'It validates that the outer autonomous runtime invokes the layout-replication capability and reads back a snapshot.',
        'Fake Photoshop means no design-quality claim.'
      ]
    },
    {
      id: 'desktop-c1163-sku-configured-execution-chain',
      title: '桌面端普通 SKU 请求应读取项目配置并执行 sku-batch',
      userInput: '帮我做一下SKU',
      mode: 'desktop_bridge',
      tags: ['desktop', 'sku', 'configured-plan', 'c1163'],
      expectation: {
        route: 'skill_execution',
        routeSource: 'deterministic_route',
        skillId: 'sku-batch',
        executionKind: 'deterministic_skill',
        shouldUseTools: true,
        shouldChangeDocument: false,
        maxIterations: 1,
        maxToolCalls: 80
      },
      expectedVisibleReasoning: '我先理解 SKU 规格和备注目标',
      notes: [
        'This case guards C-1163: a plain SKU request must execute sku-batch instead of surfacing needs_model_design_decision.',
        'The fake Photoshop path validates project CSV/template discovery, export readback evidence, and UI text boundaries only.'
      ],
      expectedUserVisibleState: {
        category: 'controlled_execution',
        title: '准备处理设计任务',
        toolUse: 'controlled_write_after_gate',
        visibleTextIncludes: ['进入对应设计能力']
      }
    },
    {
      id: 'desktop-c1163-sku-missing-project-source',
      title: '桌面端 SKU 请求缺少项目 SKU 源文件时应显示恢复路径',
      userInput: '帮我做一下SKU',
      mode: 'desktop_bridge',
      tags: ['desktop', 'sku', 'runtime-blocker', 'missing-source'],
      projectMutation: { removeProjectSkuSource: true },
      expectation: {
        route: 'skill_execution',
        routeSource: 'deterministic_route',
        skillId: 'sku-batch',
        executionKind: 'deterministic_skill',
        shouldUseTools: true,
        shouldChangeDocument: false,
        maxIterations: 1,
        maxToolCalls: 20
      },
      notes: [
        'This case guards runtime capability recovery: missing project SKU PSD/PSB must not leave the UI in a prepared-execution state.',
        'The user-visible recovery copy must remain public and must not expose internal blocker codes or local absolute paths.'
      ],
      expectedUserVisibleState: {
        category: 'blocked',
        title: '当前条件不完整',
        toolUse: 'blocked',
        canStartTools: false,
        userActionRequired: true,
        visibleTextIncludes: ['SKU PSD/PSB']
      }
    },
    {
      id: 'desktop-continuation-resumable-contract',
      title: '桌面端继续请求应直接回复并导出可恢复任务契约',
      userInput: '继续下一项',
      mode: 'desktop_bridge',
      tags: ['desktop', 'continuation', 'resumable-contract'],
      expectation: {
        route: 'direct_response',
        routeSource: 'lightweight_intent',
        executionKind: 'none',
        shouldUseTools: false,
        shouldChangeDocument: false,
        maxIterations: 0,
        maxToolCalls: 0
      },
      notes: [
        'This case validates that a continuation request does not blindly enter Photoshop execution.',
        'The resumable contract is diagnostic evidence only; it must not run provider or Photoshop by itself.'
      ],
      expectedUserVisibleState: {
        category: 'conversation',
        title: '直接回答',
        toolUse: 'no_tools',
        visibleTextIncludes: ['不调用 Photoshop 工具']
      }
    }
  ];
}

function summarizeSnapshot(snapshot) {
  return {
    isLoading: snapshot && snapshot.isLoading,
    messageCount: snapshot && snapshot.messageCount,
    messages: ((snapshot && snapshot.messages) || []).map((message) => ({
      role: message.role,
      contentPreview: message.contentPreview,
      visibleTextPreview: message.visibleTextPreview,
      thinkingStepCount: message.thinkingStepCount,
      thinkingBlockTitles: message.thinkingBlockTitles,
      agentUserVisibleState: message.agentUserVisibleState,
      toolResultCount: message.toolResultCount,
      executionStatus: message.executionStatus,
      executionSummaryPreview: message.executionSummaryPreview
    }))
  };
}

function assertUserVisibleStateSnapshot(acceptanceCase, newMessages) {
  const expected = acceptanceCase.expectedUserVisibleState;
  if (!expected) return;
  const assistantMessages = newMessages.filter((message) => message.role === 'assistant');
  const targetMessage = assistantMessages[assistantMessages.length - 1];
  assert(targetMessage, acceptanceCase.id + ' did not append an assistant message for user-visible state validation.');
  const visibleState = targetMessage.agentUserVisibleState;
  assert(visibleState, acceptanceCase.id + ' did not expose agentUserVisibleState in the real ChatPanel test snapshot.');
  assert(
    visibleState.category === expected.category,
    acceptanceCase.id + ' exposed the wrong user-visible state category: ' + JSON.stringify(visibleState)
  );
  assert(
    visibleState.title === expected.title,
    acceptanceCase.id + ' exposed the wrong user-visible state title: ' + JSON.stringify(visibleState)
  );
  assert(
    visibleState.toolUse === expected.toolUse,
    acceptanceCase.id + ' exposed the wrong user-visible tool-use scope: ' + JSON.stringify(visibleState)
  );
  if (typeof expected.canStartTools === 'boolean') {
    assert(
      visibleState.canStartTools === expected.canStartTools,
      acceptanceCase.id + ' exposed the wrong user-visible canStartTools flag: ' + JSON.stringify(visibleState)
    );
  }
  if (typeof expected.userActionRequired === 'boolean') {
    assert(
      visibleState.userActionRequired === expected.userActionRequired,
      acceptanceCase.id + ' exposed the wrong user-visible userActionRequired flag: ' + JSON.stringify(visibleState)
    );
  }
  const visibleText = [JSON.stringify(visibleState), targetMessage.visibleTextPreview || ''].join('\n');
  for (const expectedText of expected.visibleTextIncludes || []) {
    assert(
      visibleText.includes(expectedText),
      acceptanceCase.id + ' did not expose expected public user-visible state copy: ' + expectedText + ' in ' + visibleText
    );
  }
  assert(
    !/\b(?:direct_response|clarification_needed|ready_direct_response|blocked_needs_clarification|ready_read_only_plan|ready_for_tool_execution|ready_for_controlled_execution_plan|ready_for_model_planning|tool_call_failed|needs_model_design_decision|blocked_[a-z0-9_:-]+)\b/i.test(visibleText),
    acceptanceCase.id + ' user-visible state snapshot leaked internal Agent status: ' + visibleText
  );
  assert(
    !/agent-user-visible-state|agent-task-planning-contract|skill_execution|read_only_inspect|execute_skill/i.test(visibleText),
    acceptanceCase.id + ' user-visible state snapshot leaked contract, route, or request-kind internals: ' + visibleText
  );
}

async function submitAndExport(page, acceptanceCase, projectDir) {
  debugState.stage = 'submit:' + acceptanceCase.id;
  applyCaseProjectMutation(projectDir, acceptanceCase);
  const before = await page.evaluate(() => window.__DESIGNECHO_CHAT_TEST_BRIDGE__.getSnapshot());
  const submitOptions = {};
  if (acceptanceCase.imageFixture) {
    assert(fs.existsSync(acceptanceCase.imageFixture), acceptanceCase.id + ' image fixture is missing: ' + acceptanceCase.imageFixture);
    const ext = path.extname(acceptanceCase.imageFixture).toLowerCase();
    submitOptions.image = {
      data: fs.readFileSync(acceptanceCase.imageFixture).toString('base64'),
      type: ext === '.png' ? 'image/png' : 'image/jpeg'
    };
  }
  submitOptions.timeoutMs = acceptanceCase.timeoutMs || 50000;
  const after = await page.evaluate((payload) => (
    window.__DESIGNECHO_CHAT_TEST_BRIDGE__.submit(payload.input, payload.options)
  ), {
    input: acceptanceCase.userInput,
    options: submitOptions
  });
  debugState.lastSnapshot = summarizeSnapshot(after);

  const debug = await page.evaluate((casePayload) => (
    window.__DESIGNECHO_CHAT_TEST_BRIDGE__.getLatestAcceptanceDebug(casePayload)
  ), acceptanceCase);
  debugState.lastReport = debug.report;

  const newMessages = after.messages.slice(before.messageCount);
  const text = newMessages.map((message) => message.contentPreview || '').join('\n');
  const thinking = newMessages.map((message) => message.thinkingPreview || '').join('\n');

  assert(
    newMessages.some((message) => message.role === 'user' && message.contentPreview.includes(acceptanceCase.userInput)),
    acceptanceCase.id + ' did not append the user message.'
  );
  assert(newMessages.some((message) => message.role === 'assistant'), acceptanceCase.id + ' did not append an assistant message.');
  assertUserVisibleStateSnapshot(acceptanceCase, newMessages);
  if (acceptanceCase.imageFixture) {
    assert(newMessages.some((message) => message.role === 'user' && message.hasImage), acceptanceCase.id + ' did not attach the reference image.');
  }
  assert(debug.bundle && debug.bundle.caseId === acceptanceCase.id, acceptanceCase.id + ' debug bundle has the wrong caseId.');
  assert(debug.report && debug.report.caseId === acceptanceCase.id, acceptanceCase.id + ' report has the wrong caseId.');
  assert(
    debug.acceptanceDiagnostics && debug.acceptanceDiagnostics.caseId === acceptanceCase.id,
    acceptanceCase.id + ' debug export did not include acceptanceDiagnostics.'
  );
  assert(
    debug.acceptanceDiagnostics.version === 'agent-acceptance-diagnostics/v0',
    acceptanceCase.id + ' acceptanceDiagnostics has the wrong version.'
  );
  assert(
    debug.acceptanceTriage && debug.acceptanceTriage.version === 'agent-acceptance-triage/v0',
    acceptanceCase.id + ' debug export did not include acceptanceTriage.'
  );
  assert(debug.report && debug.report.status === 'passed', acceptanceCase.id + ' acceptance report did not pass: ' + JSON.stringify(debug.report, null, 2));
  assert(
    debug.acceptanceTriage.status === 'ok',
    acceptanceCase.id + ' passed acceptance report should produce ok triage.'
  );
  assert(
    !newMessages.some((message) => Array.isArray(message.thinkingBlockTitles) && message.thinkingBlockTitles.includes('正在思考')),
    acceptanceCase.id + ' kept an active thinking title after the ChatPanel test bridge reached idle: ' + JSON.stringify(newMessages, null, 2)
  );
  assert(!text.includes('Agent 面板桥接消息已生成'), acceptanceCase.id + ' leaked debug bridge copy.');
  assert(!text.includes('"intent": "debug_or_implement"'), acceptanceCase.id + ' leaked debug JSON.');
  if (acceptanceCase.expectation?.shouldUseTools) {
    const toolRunCount = Number(debug.report?.runRecords?.toolCount || 0);
    assert(toolRunCount > 0, acceptanceCase.id + ' did not expose tool runs in the shared acceptance report.');
  }
  if (acceptanceCase.id === 'desktop-continuation-resumable-contract') {
    const contract = debug.bundle?.diagnosticRecord?.agentResumableTaskContract;
    const policy = debug.bundle?.diagnosticRecord?.agentResumeExecutionPolicy;
    const gate = debug.bundle?.diagnosticRecord?.agentResumeContextGate;
    const refreshRun = debug.bundle?.diagnosticRecord?.agentResumeContextRefreshRun;
    const readonlyExecutor = debug.bundle?.diagnosticRecord?.agentResumeReadonlyContextExecutor;
    const resumePlanning = debug.bundle?.diagnosticRecord?.agentResumePlanning;
    const resumeExecutionGate = debug.bundle?.diagnosticRecord?.agentResumeExecutionGate;
    const controlledExecutionRequest = debug.bundle?.diagnosticRecord?.agentResumeControlledExecutionRequest;
    const controlledExecutionRunner = debug.bundle?.diagnosticRecord?.agentResumeControlledExecutionRunner;
    assert(contract, acceptanceCase.id + ' did not export agentResumableTaskContract diagnostics.');
    assert(policy, acceptanceCase.id + ' did not export agentResumeExecutionPolicy diagnostics.');
    assert(gate, acceptanceCase.id + ' did not export agentResumeContextGate diagnostics.');
    assert(refreshRun, acceptanceCase.id + ' did not export agentResumeContextRefreshRun diagnostics.');
    assert(resumeExecutionGate, acceptanceCase.id + ' did not export agentResumeExecutionGate diagnostics.');
    assert(controlledExecutionRequest, acceptanceCase.id + ' did not export agentResumeControlledExecutionRequest diagnostics.');
    assert(controlledExecutionRunner, acceptanceCase.id + ' did not export agentResumeControlledExecutionRunner diagnostics.');
    assert(contract.version === 'agent-resumable-task-contract/v0', acceptanceCase.id + ' exported the wrong resumable contract version.');
    assert(contract.requested === true, acceptanceCase.id + ' did not mark continuation as requested.');
    assert(contract.contextOnly === true, acceptanceCase.id + ' resumable contract must be context-only.');
    assert(contract.mustNotRunProvider === true, acceptanceCase.id + ' resumable contract must not run provider.');
    assert(contract.mustNotRunPhotoshop === true, acceptanceCase.id + ' resumable contract must not run Photoshop.');
    assert(contract.mustNotClaimTaskCompletion === true, acceptanceCase.id + ' resumable contract must not claim task completion.');
    assert(policy.version === 'agent-resume-execution-policy/v0', acceptanceCase.id + ' exported the wrong resume policy version.');
    assert(policy.controlContextOnly === true, acceptanceCase.id + ' resume policy must be control-context only.');
    assert(policy.writesPerformed === false, acceptanceCase.id + ' resume policy must not perform writes.');
    assert(policy.shouldAutoExecute === false, acceptanceCase.id + ' resume policy must not auto execute.');
    assert(policy.shouldRunPhotoshop === false, acceptanceCase.id + ' resume policy must not run Photoshop.');
    assert(policy.mustNotClaimTaskCompletion === true, acceptanceCase.id + ' resume policy must not claim task completion.');
    assert(gate.version === 'agent-resume-context-gate/v0', acceptanceCase.id + ' exported the wrong resume context gate version.');
    assert(gate.controlContextOnly === true, acceptanceCase.id + ' resume context gate must be control-context only.');
    assert(gate.writesPerformed === false, acceptanceCase.id + ' resume context gate must not perform writes.');
    assert(gate.mustNotRunWriteTools === true, acceptanceCase.id + ' resume context gate must not run write tools.');
    assert(gate.mustNotClaimTaskCompletion === true, acceptanceCase.id + ' resume context gate must not claim task completion.');
    assert(refreshRun.version === 'agent-resume-context-refresh-runner/v0', acceptanceCase.id + ' exported the wrong resume context refresh run version.');
    assert(refreshRun.controlContextOnly === true, acceptanceCase.id + ' resume context refresh run must be control-context only.');
    assert(refreshRun.writesPerformed === false, acceptanceCase.id + ' resume context refresh run must not perform writes.');
    assert(refreshRun.rawPayloadRedacted === true, acceptanceCase.id + ' resume context refresh run must redact raw payloads.');
    assert(refreshRun.mustNotRunWriteTools === true, acceptanceCase.id + ' resume context refresh run must not run write tools.');
    assert(refreshRun.mustNotClaimTaskCompletion === true, acceptanceCase.id + ' resume context refresh run must not claim task completion.');
    assert(
      [
        'ready_for_model_contextual_reply',
        'blocked_last_turn_completed',
        'candidate_for_execution_resume',
        'blocked_last_turn_failed',
        'blocked_missing_execution_context'
      ].includes(contract.status),
      acceptanceCase.id + ' produced an unexpected resumable contract status: ' + contract.status
    );
    assert(
      [
        'reply_with_context',
        'block_and_explain',
        'request_fresh_context_before_resume',
        'resume_candidate_needs_model_decision'
      ].includes(policy.action),
      acceptanceCase.id + ' produced an unsafe resume policy action: ' + policy.action
    );
    assert(
      [
        'blocked_policy_not_resumable',
        'ready_for_readonly_context_refresh',
        'ready_for_resume_planning',
        'blocked_missing_photoshop_connection',
        'blocked_missing_document'
      ].includes(gate.status),
      acceptanceCase.id + ' produced an unsafe resume context gate status: ' + gate.status
    );
    assert(
      [
        'not_applicable',
        'blocked_gate_not_refreshable',
        'waiting_for_readonly_observations',
        'partial_readonly_observations',
        'fresh_context_ready'
      ].includes(refreshRun.status),
      acceptanceCase.id + ' produced an unsafe resume context refresh run status: ' + refreshRun.status
    );
    if (readonlyExecutor) {
      assert(readonlyExecutor.version === 'agent-resume-readonly-context-executor/v0', acceptanceCase.id + ' exported the wrong readonly executor version.');
      assert(readonlyExecutor.controlContextOnly === true, acceptanceCase.id + ' readonly executor must be control-context only.');
      assert(readonlyExecutor.writesPerformed === false, acceptanceCase.id + ' readonly executor must not perform writes.');
      assert(readonlyExecutor.rawPayloadRedacted === true, acceptanceCase.id + ' readonly executor must redact raw payloads.');
      assert(readonlyExecutor.mustNotRunWriteTools === true, acceptanceCase.id + ' readonly executor must not run write tools.');
      assert(readonlyExecutor.mustNotClaimTaskCompletion === true, acceptanceCase.id + ' readonly executor must not claim task completion.');
      assert(
        [
          'not_applicable',
          'blocked_refresh_run_not_ready',
          'blocked_missing_readonly_tools',
          'completed_readonly_refresh',
          'failed_readonly_refresh'
        ].includes(readonlyExecutor.status),
        acceptanceCase.id + ' produced an unsafe readonly executor status: ' + readonlyExecutor.status
      );
    }
    if (resumePlanning) {
      assert(resumePlanning.version === 'agent-resume-planning/v0', acceptanceCase.id + ' exported the wrong resume planning version.');
      assert(resumePlanning.controlContextOnly === true, acceptanceCase.id + ' resume planning must be control-context only.');
      assert(resumePlanning.writesPerformed === false, acceptanceCase.id + ' resume planning must not perform writes.');
      assert(resumePlanning.rawPayloadRedacted === true, acceptanceCase.id + ' resume planning must redact raw payloads.');
      assert(resumePlanning.shouldRunPhotoshop === false, acceptanceCase.id + ' resume planning must not run Photoshop.');
      assert(resumePlanning.mustNotRunWriteTools === true, acceptanceCase.id + ' resume planning must not run write tools.');
      assert(resumePlanning.mustNotClaimTaskCompletion === true, acceptanceCase.id + ' resume planning must not claim task completion.');
      assert(resumePlanning.requiresExplicitExecutionApproval === true, acceptanceCase.id + ' resume planning must require explicit execution approval.');
      assert(
        [
          'not_applicable',
          'blocked_readonly_context_not_ready',
          'ready_for_model_resume_plan',
          'model_resume_plan_available',
          'model_resume_plan_failed'
        ].includes(resumePlanning.status),
        acceptanceCase.id + ' produced an unsafe resume planning status: ' + resumePlanning.status
      );
    }
    if (resumeExecutionGate) {
      assert(resumeExecutionGate.version === 'agent-resume-execution-gate/v0', acceptanceCase.id + ' exported the wrong resume execution gate version.');
      assert(resumeExecutionGate.writesPerformed === false, acceptanceCase.id + ' resume execution gate must not perform writes.');
      assert(resumeExecutionGate.rawPayloadRedacted === true, acceptanceCase.id + ' resume execution gate must redact raw payloads.');
      assert(resumeExecutionGate.shouldRunPhotoshop === false, acceptanceCase.id + ' resume execution gate must not run Photoshop itself.');
      assert(resumeExecutionGate.mustNotRunWriteTools === true, acceptanceCase.id + ' resume execution gate must not run write tools itself.');
      assert(resumeExecutionGate.mustNotClaimTaskCompletion === true, acceptanceCase.id + ' resume execution gate must not claim task completion.');
      assert(resumeExecutionGate.requiresExplicitUserApproval === true, acceptanceCase.id + ' resume execution gate must require explicit user approval.');
      assert(resumeExecutionGate.requiresWriteToolWhitelist === true, acceptanceCase.id + ' resume execution gate must require write tool whitelist.');
      assert(resumeExecutionGate.requiresReadbackTargets === true, acceptanceCase.id + ' resume execution gate must require readback targets.');
      assert(resumeExecutionGate.canDispatchWriteTools !== true, acceptanceCase.id + ' continuation must not dispatch write tools by default.');
      assert(
        [
          'not_applicable',
          'blocked_resume_plan_not_available',
          'blocked_model_plan_parse_failed',
          'blocked_model_plan_requested_writes',
          'blocked_missing_executable_resume_plan',
          'blocked_missing_write_tool_whitelist',
          'blocked_write_tool_not_allowed',
          'blocked_missing_readback_targets',
          'blocked_pending_user_approval'
        ].includes(resumeExecutionGate.status),
        acceptanceCase.id + ' produced an unsafe resume execution gate status: ' + resumeExecutionGate.status
      );
    }
    if (controlledExecutionRequest) {
      assert(controlledExecutionRequest.version === 'agent-resume-controlled-execution-request/v0', acceptanceCase.id + ' exported the wrong controlled execution request version.');
      assert(controlledExecutionRequest.writesPerformed === false, acceptanceCase.id + ' controlled execution request must not perform writes.');
      assert(controlledExecutionRequest.rawPayloadRedacted === true, acceptanceCase.id + ' controlled execution request must redact raw payloads.');
      assert(controlledExecutionRequest.shouldRunPhotoshop === false, acceptanceCase.id + ' controlled execution request must not run Photoshop itself.');
      assert(controlledExecutionRequest.mustNotRunWriteTools === true, acceptanceCase.id + ' controlled execution request must not run write tools itself.');
      assert(controlledExecutionRequest.mustNotClaimTaskCompletion === true, acceptanceCase.id + ' controlled execution request must not claim task completion.');
      assert(controlledExecutionRequest.requiresControlledRunner === true, acceptanceCase.id + ' controlled execution request must require a controlled runner.');
      assert(controlledExecutionRequest.requiresReadbackAfterEachWrite === true, acceptanceCase.id + ' controlled execution request must require readback after each write.');
      assert(controlledExecutionRequest.canStartControlledRunner !== true, acceptanceCase.id + ' continuation must not start a controlled runner by default.');
      assert(
        [
          'not_applicable',
          'blocked_execution_gate_not_ready',
          'blocked_execution_disabled'
        ].includes(controlledExecutionRequest.status),
        acceptanceCase.id + ' produced an unsafe controlled execution request status: ' + controlledExecutionRequest.status
      );
    }
    if (controlledExecutionRunner) {
      assert(controlledExecutionRunner.version === 'agent-resume-controlled-execution-runner/v0', acceptanceCase.id + ' exported the wrong controlled execution runner version.');
      assert(controlledExecutionRunner.writesPerformed === false, acceptanceCase.id + ' controlled execution runner must not perform writes by default.');
      assert(controlledExecutionRunner.verificationStatus === 'not_run', acceptanceCase.id + ' controlled execution runner must not report verification by default.');
      assert(controlledExecutionRunner.rawPayloadRedacted === true, acceptanceCase.id + ' controlled execution runner must redact raw payloads.');
      assert(controlledExecutionRunner.shouldRunPhotoshop === false, acceptanceCase.id + ' controlled execution runner must not run Photoshop by default.');
      assert(controlledExecutionRunner.mustNotRunWriteTools === true, acceptanceCase.id + ' controlled execution runner must not run write tools by default.');
      assert(controlledExecutionRunner.mustNotClaimTaskCompletion === true, acceptanceCase.id + ' controlled execution runner must not claim task completion.');
      assert(Array.isArray(controlledExecutionRunner.executedWriteTools) && controlledExecutionRunner.executedWriteTools.length === 0, acceptanceCase.id + ' controlled execution runner must not record executed write tools by default.');
      assert(
        [
          'not_applicable',
          'blocked_request_not_ready'
        ].includes(controlledExecutionRunner.status),
        acceptanceCase.id + ' produced an unsafe controlled execution runner status: ' + controlledExecutionRunner.status
      );
    }
    assert(Number(debug.report?.runRecords?.toolCount || 0) === 0, acceptanceCase.id + ' continuation request unexpectedly used tools.');
  }
  if (acceptanceCase.id === 'desktop-c1163-sku-configured-execution-chain') {
    const visible = [text, thinking].join('\n');
    assert(!visible.includes('<tool_call>'), acceptanceCase.id + ' leaked pseudo tool_call markup.');
    assert(!visible.includes('</tool_call>'), acceptanceCase.id + ' leaked pseudo tool_call markup.');
    assert(!visible.includes('<function'), acceptanceCase.id + ' leaked pseudo XML function markup.');
    assert(!visible.includes('<parameter'), acceptanceCase.id + ' leaked pseudo XML parameter markup.');
    assert(!visible.includes('Conversational reply unavailable'), acceptanceCase.id + ' leaked conversational fallback error.');
    assert(!visible.includes('needs_model_design_decision'), acceptanceCase.id + ' leaked internal design-decision gate status.');

    const lifecycle = debug.bundle?.lifecycle;
    assert(lifecycle?.decision?.route === 'skill_execution', acceptanceCase.id + ' lifecycle route was not skill_execution.');
    assert(lifecycle?.decision?.source === 'deterministic_route', acceptanceCase.id + ' lifecycle source was not deterministic_route.');
    assert(lifecycle?.decision?.skillId === 'sku-batch', acceptanceCase.id + ' lifecycle did not select sku-batch.');

    const diagnosticRecord = debug.bundle?.diagnosticRecord;
    const recordKeys = diagnosticRecord?.recordKeys || [];
    assert(recordKeys.includes('skuConfiguredExecutionPlan'), acceptanceCase.id + ' did not export skuConfiguredExecutionPlan diagnostics.');
    assert(recordKeys.includes('skuExecutionManifest'), acceptanceCase.id + ' did not export skuExecutionManifest diagnostics.');
    assert(recordKeys.includes('skuExportReadback'), acceptanceCase.id + ' did not export skuExportReadback diagnostics.');

    const configuredPlan = diagnosticRecord?.skuConfiguredExecutionPlan;
    const executionManifest = diagnosticRecord?.skuExecutionManifest;
    const exportReadback = diagnosticRecord?.skuExportReadback;
    assert(configuredPlan?.schema === 'sku-configured-execution-plan/v0', acceptanceCase.id + ' exported the wrong configured plan schema.');
    assert(configuredPlan?.status === 'ready_configured_execution_plan', acceptanceCase.id + ' configured SKU plan was not ready.');
    assert(Number(configuredPlan?.comboExecutionCount || 0) > 0, acceptanceCase.id + ' configured SKU plan did not include combo rows.');
    assert(Number(configuredPlan?.noteExecutionCount || 0) > 0, acceptanceCase.id + ' configured SKU plan did not include self-select note rows.');
    assert(Array.isArray(executionManifest) && executionManifest.some((item) => item?.status === 'ready'), acceptanceCase.id + ' execution manifest did not include a ready SKU size.');
    assert(exportReadback?.version === 'sku-export-readback/v0', acceptanceCase.id + ' exported the wrong SKU readback version.');
    assert(exportReadback?.status === 'ready_for_review', acceptanceCase.id + ' SKU export readback was not ready_for_review.');
    assert(Number(exportReadback?.okFileProbeCount || 0) >= 2, acceptanceCase.id + ' SKU export readback did not verify combo and note files.');
  }
  if (acceptanceCase.expectedThinkingPattern) {
    const hasExpectedVisibleToolText = new RegExp(acceptanceCase.expectedThinkingPattern).test(thinking);
    const hasSharedToolRunRecord = Number(debug.report?.runRecords?.toolCount || 0) > 0;
    assert(
      hasExpectedVisibleToolText || hasSharedToolRunRecord,
      acceptanceCase.id + ' did not expose expected tool activity in visible steps or the shared report.'
    );
  }
  if (acceptanceCase.expectedVisibleReasoning) {
    assert(
      thinking.includes(acceptanceCase.expectedVisibleReasoning),
      acceptanceCase.id + ' did not expose the expected provider-authored visible reasoning preview. Thinking: ' + thinking
    );
    assert(!thinking.includes('等待响应'), acceptanceCase.id + ' leaked hard-coded waiting text into thinking.');
    assert(!thinking.includes('正在准备'), acceptanceCase.id + ' leaked hard-coded preparing text into thinking.');
    assert(!thinking.includes('工具完成'), acceptanceCase.id + ' treated tool completion as the expected visible reasoning preview.');
  }

  return {
    id: acceptanceCase.id,
    status: debug.report.status,
    summary: debug.report.summary,
    issueLayers: debug.report.issueLayers,
    runRecords: debug.report.runRecords,
    acceptanceDiagnostics: debug.acceptanceDiagnostics,
    acceptanceTriage: debug.acceptanceTriage,
    checkCount: debug.report.checks.length,
    bundle: debug.bundle,
    report: debug.report
  };
}

async function main() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const mainEntry = path.join(ROOT, pkg.main || 'dist/main/main/index.js');
  const rendererEntry = path.join(ROOT, 'dist', 'renderer', 'index.html');
  assert(fs.existsSync(mainEntry), 'Missing built Electron main entry: ' + mainEntry + '. Run npm run build first.');
  assert(fs.existsSync(rendererEntry), 'Missing built renderer entry: ' + rendererEntry + '. Run npm run build first.');

  const testPortBase = await findFreePortBlock();
  const userDataDir = resetDir('agent-desktop-acceptance-user-data');
  const projectDir = resetTestProjectDir();
  const acceptanceCases = buildAcceptanceCases();
  let app;

  try {
    debugState.stage = 'launch';
    app = await electron.launch({
      args: [ROOT, '--user-data-dir=' + userDataDir],
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
    debugState.stage = 'renderer-load';
    await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
    await page.waitForFunction(() => !!window.__DESIGNECHO_CHAT_TEST_BRIDGE__, null, { timeout: 30000 });

    const bridgeInfo = await page.evaluate(() => ({
      hasBridge: !!window.__DESIGNECHO_CHAT_TEST_BRIDGE__,
      hasAcceptanceDebug: typeof window.__DESIGNECHO_CHAT_TEST_BRIDGE__?.getLatestAcceptanceDebug === 'function',
      query: window.location.search
    }));
    assert(bridgeInfo.hasBridge, 'ChatPanel test bridge is not available.');
    assert(bridgeInfo.hasAcceptanceDebug, 'ChatPanel test bridge did not expose getLatestAcceptanceDebug.');
    assert(String(bridgeInfo.query).includes('designechoChatTestBridge=1'), 'Renderer query did not enable the test bridge.');

    const cases = [];
    for (const acceptanceCase of acceptanceCases) {
      cases.push(await submitAndExport(page, acceptanceCase, projectDir));
    }

    const result = {
      success: cases.every((item) => item.status === 'passed'),
      skipped: false,
      mode: 'desktop-bridge-fake-provider-fake-photoshop',
      isolatedPorts: {
        ws: testPortBase,
        webview: testPortBase + 1,
        debugBridge: testPortBase + 2,
        mcpHost: testPortBase + 3
      },
      testUserDataDir: userDataDir,
      testProjectDir: projectDir,
      cases,
      checks: [
        'Electron desktop app launched with isolated userData and isolated ports.',
        'ChatPanel test bridge exposed getLatestAcceptanceDebug.',
        'Desktop ChatPanel requests produced assistant messages with persisted lifecycle metadata.',
        'Latest assistant messages were converted to AgentRunDebugBundle, AgentAcceptanceReport, acceptanceDiagnostics and acceptanceTriage.',
        'Document-management save and close cases passed the shared acceptance evaluator.',
        'C-1142 attached-image reference replication case passed the shared acceptance evaluator.',
        'C-1163 plain SKU request read project config and exported combo plus self-select note diagnostics.',
        'Continuation request exported agentResumableTaskContract diagnostics and did not use Photoshop tools.',
        'A deterministic desktop request exposed provider-authored public visible reasoning before tool evidence.',
        'No debug bridge JSON was exposed in the visible assistant reply.'
      ],
      boundaries: [
        'This smoke uses fake model and fake Photoshop to validate the desktop bridge and evidence export path.',
        'It does not prove live provider quality, real Photoshop disk writes, or design aesthetics.',
        'Live Photoshop acceptance must remain an explicit command with takeover safeguards.'
      ],
      report: {
        json: REPORT_JSON,
        md: REPORT_MD
      }
    };
    writeReports(result);
    console.log(JSON.stringify({
      success: result.success,
      skipped: result.skipped,
      mode: result.mode,
      report: result.report,
      cases: cases.map((item) => ({
        id: item.id,
        status: item.status,
        summary: item.summary
      }))
    }, null, 2));
    if (!result.success) process.exit(1);
  } finally {
    if (app) {
      await app.close().catch(() => undefined);
    }
  }
}

main().catch((error) => {
  const result = {
    success: false,
    error: error && error.stack ? error.stack : (error && error.message ? error.message : String(error)),
    debug: debugState,
    report: {
      json: REPORT_JSON,
      md: REPORT_MD
    }
  };
  writeReports(result);
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
});
