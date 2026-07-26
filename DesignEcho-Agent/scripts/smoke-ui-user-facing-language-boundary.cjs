#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const ROOT = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

const guardedFiles = [
  'src/renderer/components/ChatPanel.tsx',
  'src/renderer/components/DesignAgentWorkbench.tsx',
  'src/renderer/components/SettingsModal.tsx',
  'src/renderer/components/message/blocks/ToolResultBlock.tsx',
  'src/renderer/components/message/parser.ts',
  'src/renderer/services/agent-orchestration/conversational.ts',
  'src/renderer/services/agent-runtime/agent.ts',
  'src/renderer/services/agent-visible-feedback.ts',
  'src/renderer/services/design-agent/engine.ts',
  'src/renderer/services/skill-executors/layout-replication-completion.ts',
  'src/renderer/services/skill-executors/layout-replication.executor.ts',
  'src/renderer/services/skill-executors/layout-replication-qa.ts',
  'src/renderer/services/skill-executors/business-skill-visual-context.ts',
  'src/renderer/services/tool-executor.service.ts',
  'src/shared/business-skill-visual-observation-feedback.ts',
  'src/shared/agent-user-visible-state.ts',
  'src/shared/agent-tool-decision-contract.ts',
  'src/shared/chat-response-cleaner.ts',
  'src/shared/detail-page-skill-readiness.ts',
  'src/shared/design-result-review-panel.ts'
];

const forbiddenProductPhrases = [
  '项目证据',
  '素材证据',
  '过程诊断',
  '审查边界',
  '来源证据',
  '设计知识证据',
  '开发诊断',
  '证据屏',
  '证据型文案',
  '视觉证据:',
  'Overlay 证据:',
  '结构/证据',
  '诊断证据',
  '无截图证据',
  '截图证据',
  '证据:',
  '边界:',
  '基于已有证据',
  '当前缺少项目视觉证据',
  '项目视觉证据，允许',
  '可审计的设计计划',
  '项目概览',
  '项目结构详情',
  '业务素材概览',
  '审查线索',
  '项目视觉证据可用',
  '项目视觉证据不完整',
  '当前任务不需要项目视觉证据',
  '项目视觉证据需要复核',
  '已有候选图片，但视觉理解证据不足',
  '缺少证据',
  '类证据',
  '只读执行/QA 证据',
  '执行/QA 证据',
  '工具路径',
  '工具循环',
  '允许工具范围',
  '验收目标',
  '业务 Skill',
  '业务 skill',
  '读回结果',
  '受控执行',
  '执行器',
  '执行条件未满足',
  '没有执行工具'
];

const guardedExecutorMessageFiles = [
  'src/renderer/services/tool-executor.service.ts',
  'src/renderer/services/skill-executors/main-image.executor.ts',
  'src/renderer/services/skill-executors/layer-management.executor.ts',
  'src/renderer/services/skill-executors/text-font-replace.executor.ts',
  'src/renderer/services/skill-executors/find-edit-element.executor.ts'
];

const guardedCallbackMessageFiles = [
  'src/renderer/services/skill-executors/design-pipeline.ts',
  'src/renderer/services/design-skills/main-image-design.skill.ts',
  'src/renderer/services/skill-executors/main-image.executor.ts'
];

const forbiddenExecutorMessageMarkers = [
  { label: 'strategy=', pattern: /\bstrategy\s*=/i },
  { label: 'checkpoint=', pattern: /\bcheckpoint\s*=/i },
  { label: 'adapter=', pattern: /\badapter\s*=/i },
  { label: 'debug status field', pattern: /\b(?:runner|qaGate|qaBridge|screenshotQa|probeReadiness|qaReport|acceptanceRecord|resultImages|fileProbes|executed|failedOperations|failedReadback|liveRequest)\s*=/i },
  { label: 'Planner readiness', pattern: /Planner\s+readiness/i },
  { label: 'gate=', pattern: /\bgate\s*=/i },
  { label: 'layerId', pattern: /\blayerId\b|图层\s*ID|图层：[\s\S]*?\(\s*ID\s*:/i },
  { label: 'candidate score', pattern: /candidate\s+score|候选[\s\S]*?分数|score\s*:/i },
  { label: 'parentGroup', pattern: /\bparentGroup\b/i },
  { label: 'raw JSON', pattern: /raw\s+JSON|rawJson|JSON\.stringify/i },
  { label: 'local path', pattern: /local\s+path|本地路径|绝对路径|\b(?:relativePath|outputPath|sourceDocumentPath|filePath|assetPath|exportTarget)\b/i },
  { label: 'main-image internal result count', pattern: /结果图片：|文件读回：/ },
  { label: 'bridge debug', pattern: /bridge\s+debug|调试\s*bridge|bridge\s*调试/i }
];

const forbiddenCallbackMessageMarkers = [
  ...forbiddenExecutorMessageMarkers,
  { label: 'design-agent tool name', pattern: /\bdesign-agent\./i },
  { label: 'DesignPipeline internal name', pattern: /\bDesignPipeline\b/i },
  { label: 'diagnosis service unavailable', pattern: /设计诊断服务不可用/i },
  { label: 'planning service unavailable', pattern: /设计规划服务不可用/i },
  { label: 'raw design score label', pattern: /当前设计评分/i },
  { label: 'generated copy candidate debug copy', pattern: /Generated copy candidate/i },
  { label: 'raw plan tool field', pattern: /\bstep\.tool\b/i },
  { label: 'quick export debug marker', pattern: /\bquickExport\b/i }
];

const guardedAssistantContentFiles = [
  'src/renderer/components/ChatPanel.tsx',
  'src/renderer/components/message/parser.ts',
  'src/renderer/components/message/blocks/ToolResultBlock.tsx',
  'src/renderer/services/agent-visible-feedback.ts',
  'src/shared/agent-user-visible-state.ts',
  'src/shared/chat-response-cleaner.ts'
];

const forbiddenAssistantVisibleMarkers = [
  ...forbiddenExecutorMessageMarkers,
  { label: 'MCP 通道', pattern: /MCP\s*通道/i },
  { label: 'Legacy IPC', pattern: /Legacy\s+IPC/i },
  { label: 'source_hint', pattern: /\bsource_hint\b/i },
  { label: 'readonly_verified', pattern: /\breadonly_verified\b/i },
  { label: 'server_accept_verified', pattern: /\bserver_accept_verified\b/i },
  { label: 'rawPayloadRedacted', pattern: /\brawPayloadRedacted\b/i },
  { label: 'direct_response', pattern: /\bdirect_response\b/i },
  { label: 'clarification_needed', pattern: /\bclarification_needed\b/i },
  { label: 'needs_model_design_decision', pattern: /\bneeds_model_design_decision\b/i }
];

const sourceLevelMarkerFiles = [
  'src/renderer/components/ChatPanel.tsx',
  'src/main/testing/chat-test-fake-model.ts',
  'src/main/testing/fixtures/chat-ui-electron-bridge-text.fixture.json',
  'src/renderer/testing/chat-panel-test-bridge.ts',
  'scripts/acceptance-run-agent-desktop-case.cjs'
];

const forbiddenNormalSourceMarkers = [
  { label: 'strategy=', pattern: /\bstrategy\s*=/i },
  { label: 'checkpoint=', pattern: /\bcheckpoint\s*=/i },
  { label: 'adapter=', pattern: /\badapter\s*=/i },
  { label: 'Planner', pattern: /\bPlanner\b/i },
  { label: 'MCP 通道', pattern: /MCP\s*通道/i },
  { label: 'Legacy IPC', pattern: /Legacy\s+IPC/i },
  { label: 'source_hint', pattern: /\bsource_hint\b/i },
  { label: 'readonly_verified', pattern: /\breadonly_verified\b/i },
  { label: 'server_accept_verified', pattern: /\bserver_accept_verified\b/i },
  { label: 'rawPayloadRedacted', pattern: /\brawPayloadRedacted\b/i },
  { label: 'direct_response', pattern: /\bdirect_response\b/i },
  { label: 'clarification_needed', pattern: /\bclarification_needed\b/i },
  { label: 'needs_model_design_decision', pattern: /\bneeds_model_design_decision\b/i },
  { label: 'candidate score', pattern: /candidate\s+score/i }
];

const debugOnlyOrTestFixtureFiles = new Set([
  'src/main/testing/chat-test-fake-model.ts',
  'src/main/testing/fixtures/chat-ui-electron-bridge-text.fixture.json',
  'src/renderer/testing/chat-panel-test-bridge.ts',
  'scripts/acceptance-run-agent-desktop-case.cjs'
]);

const requiredDebugOnlyContracts = [
  {
    file: 'src/renderer/components/ChatPanel.tsx',
    required: [
      'isChatTestFakeModelRuntime',
      'looksLikeChatTestFakeModelText',
      'testFixtureReplyOrigin',
      "cmd.startsWith('/desktop-debug')",
      "toolSummaryReplyOrigin('desktop-debug:report')"
    ]
  },
  {
    file: 'src/main/testing/chat-test-fake-model.ts',
    required: [
      'DESIGNECHO_CHAT_TEST_FAKE_MODEL_FIXTURE',
      '测试 fixture 已收到请求',
      '测试样本：',
      '未调用真实模型或 Photoshop'
    ]
  },
  {
    file: 'src/main/testing/fixtures/chat-ui-electron-bridge-text.fixture.json',
    required: [
      '"markerPrefix": "测试样本："',
      '"footer": "未调用真实模型或 Photoshop。"'
    ]
  },
  {
    file: 'src/renderer/testing/chat-panel-test-bridge.ts',
    required: [
      'isChatPanelTestBridgeEnabled',
      'contentPreview',
      'visibleTextPreview'
    ]
  }
];

function propertyNameText(name) {
  if (!name) return '';
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return '';
}

function collectPropertyExpressions(relativePath, propertyNames) {
  const source = read(relativePath);
  const sourceFile = ts.createSourceFile(relativePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const expressions = [];

  function visit(node) {
    if (ts.isPropertyAssignment(node) && propertyNames.includes(propertyNameText(node.name))) {
      const position = sourceFile.getLineAndCharacterOfPosition(node.initializer.getStart(sourceFile));
      expressions.push({
        file: relativePath,
        line: position.line + 1,
        column: position.character + 1,
        property: propertyNameText(node.name),
        expression: node.initializer.getText(sourceFile)
      });
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return expressions;
}

function collectOnMessageExpressions(relativePath) {
  const source = read(relativePath);
  const sourceFile = ts.createSourceFile(relativePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const expressions = [];

  function visit(node) {
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(sourceFile);
      if (/(^|\.|\?)onMessage(\?|$)/.test(callee) && node.arguments.length > 0) {
        const position = sourceFile.getLineAndCharacterOfPosition(node.arguments[0].getStart(sourceFile));
        expressions.push({
          file: relativePath,
          line: position.line + 1,
          expression: node.arguments[0].getText(sourceFile)
        });
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return expressions;
}

function findExecutorMessageMarkerLeaks() {
  const leaks = [];
  for (const file of guardedExecutorMessageFiles) {
    for (const messageExpression of collectPropertyExpressions(file, ['message'])) {
      for (const marker of forbiddenExecutorMessageMarkers) {
        if (marker.pattern.test(messageExpression.expression)) {
          leaks.push({
            file: messageExpression.file,
            line: messageExpression.line,
            property: messageExpression.property,
            marker: marker.label,
            expression: messageExpression.expression
          });
        }
      }
    }
  }
  return leaks;
}

function findCallbackMessageMarkerLeaks() {
  const leaks = [];
  for (const file of guardedCallbackMessageFiles) {
    for (const messageExpression of collectOnMessageExpressions(file)) {
      for (const marker of forbiddenCallbackMessageMarkers) {
        if (marker.pattern.test(messageExpression.expression)) {
          leaks.push({
            file: messageExpression.file,
            line: messageExpression.line,
            marker: marker.label,
            expression: messageExpression.expression
          });
        }
      }
    }
  }
  return leaks;
}

function findAssistantVisibleMarkerLeaks() {
  const leaks = [];
  for (const file of guardedAssistantContentFiles) {
    const expressions = collectPropertyExpressions(file, [
      'content',
      'message',
      'summary',
      'title',
      'description',
      'label',
      'value',
      'actionHint',
      'nextStep'
    ]);
    for (const expression of expressions) {
      for (const marker of forbiddenAssistantVisibleMarkers) {
        if (marker.pattern.test(expression.expression)) {
          leaks.push({
            file: expression.file,
            line: expression.line,
            property: expression.property,
            marker: marker.label,
            expression: expression.expression
          });
        }
      }
    }
  }
  return leaks;
}

function getLineNumberAt(source, index) {
  return source.slice(0, index).split(/\r?\n/).length;
}

function getLineContext(source, line, radius = 3) {
  const lines = source.split(/\r?\n/);
  const start = Math.max(1, line - radius);
  const end = Math.min(lines.length, line + radius);
  return lines.slice(start - 1, end).join('\n');
}

function isAllowedDebugOnlyMarkerUse(file, markerLabel, context) {
  if (debugOnlyOrTestFixtureFiles.has(file)) return true;
  if (file !== 'src/renderer/components/ChatPanel.tsx') return false;
  if (/desktop-debug|slash-command:debug|\/debug\b|debugInferDecisionFromText/.test(context)) return true;
  if (/isChatTestFakeModelRuntime|looksLikeChatTestFakeModelText|testFixtureReplyOrigin|sanitizeTestSnapshot|acceptance debug/i.test(context)) return true;
  if (/route\s*===|purpose\s*===|requestKind|lifecycle\?\.decision/.test(context)) {
    return ['direct_response', 'clarification_needed', 'needs_model_design_decision'].includes(markerLabel);
  }
  return false;
}

function findNonDebugSourceMarkerLeaks() {
  const leaks = [];
  const allowed = [];
  for (const file of sourceLevelMarkerFiles) {
    const source = read(file);
    for (const marker of forbiddenNormalSourceMarkers) {
      const flags = marker.pattern.flags.includes('g')
        ? marker.pattern.flags
        : `${marker.pattern.flags}g`;
      const pattern = new RegExp(marker.pattern.source, flags);
      let match;
      while ((match = pattern.exec(source)) !== null) {
        const line = getLineNumberAt(source, match.index);
        const context = getLineContext(source, line);
        const hit = {
          file,
          line,
          marker: marker.label,
          text: match[0],
          context
        };
        if (isAllowedDebugOnlyMarkerUse(file, marker.label, context)) {
          allowed.push(hit);
        } else {
          leaks.push(hit);
        }
        if (match[0] === '') pattern.lastIndex += 1;
      }
    }
  }
  return { leaks, allowed };
}

function findMissingDebugOnlyContracts() {
  const missing = [];
  for (const contract of requiredDebugOnlyContracts) {
    const source = read(contract.file);
    for (const text of contract.required) {
      if (!source.includes(text)) {
        missing.push({
          file: contract.file,
          required: text
        });
      }
    }
  }
  return missing;
}

function extractSwitchCase(source, caseLabel) {
  const start = source.indexOf(`case '${caseLabel}':`);
  if (start < 0) return '';
  const tail = source.slice(start);
  const end = tail.search(/\n\s*case\s+'|\n\s*default\s*:/);
  return end >= 0 ? tail.slice(0, end) : tail;
}

function findUserHelpDiagnosticsLeaks() {
  const source = read('src/renderer/components/ChatPanel.tsx');
  const helpCase = extractSwitchCase(source, '/help');
  const leaks = [];
  if (!helpCase) {
    leaks.push({ file: 'src/renderer/components/ChatPanel.tsx', line: 0, marker: 'missing /help case' });
    return leaks;
  }
  for (const pattern of [/`\/test`/i, /`\/debug\b/i, /`\/desktop-debug\b/i, /调试命令/, /工具连接.*测试/]) {
    if (pattern.test(helpCase)) {
      leaks.push({
        file: 'src/renderer/components/ChatPanel.tsx',
        line: getLineNumberAt(source, source.indexOf(helpCase)),
        marker: `help exposes diagnostics: ${pattern.source}`
      });
    }
  }
  return leaks;
}

function findSkuExecutorInternalProgressLeaks() {
  const source = read('src/renderer/services/skill-executors/sku-batch.executor.ts');
  const forbiddenSnippets = [
    'callbacks?.onMessage?.(`📚 已加载本地模板库',
    'callbacks?.onMessage?.(`📚 本地模板库可用规格',
    'callbacks?.onMessage?.(\'📚 当前项目模板目录未识别到 SKU 模板，已允许回退到本地模板库。\')',
    'callbacks?.onMessage?.(\'🔍 正在扫描项目模板与本地模板库以自动推断规格...\')',
    'callbacks?.onMessage?.(`📊 解析参数:',
    'callbacks?.onMessage?.(`🧠 已理解你的 SKU 要求',
    'callbacks?.onMessage?.(\'🧭 正在一次性准备 SKU 执行清单和模板文档...\')',
    'callbacks?.onMessage?.(`✅ SKU 执行清单准备完成',
    '无法获取 Photoshop 文档列表',
    '当前无法从 UXP 读取已打开文档',
    '在「${templateDir}」下放入',
    "templateDir || '模板目录'",
    '本地模板库目录'
  ];
  return forbiddenSnippets
    .filter((snippet) => source.includes(snippet))
    .map((snippet) => ({
      file: 'src/renderer/services/skill-executors/sku-batch.executor.ts',
      line: getLineNumberAt(source, source.indexOf(snippet)),
      marker: snippet
    }));
}

function findLongDetailWrappingFailures() {
  const css = read('src/renderer/components/message/MessageRenderer.css');
  const failures = [];
  if (!/\.detail-item\s*\{[\s\S]*?flex-wrap\s*:\s*wrap\s*;[\s\S]*?\}/.test(css)) {
    failures.push({
      file: 'src/renderer/components/message/MessageRenderer.css',
      marker: '.detail-item must wrap long detail rows'
    });
  }
  if (!/\.detail-value\s*\{[\s\S]*?flex\s*:\s*1\s+1\s+\d+px\s*;[\s\S]*?\}/.test(css)) {
    failures.push({
      file: 'src/renderer/components/message/MessageRenderer.css',
      marker: '.detail-value must shrink and wrap inside the message width'
    });
  }
  return failures;
}

function listFilesRecursive(rootDir) {
  if (!fs.existsSync(rootDir)) return [];
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', 'dist', 'build', 'out', 'coverage', 'tmp'].includes(entry.name)) continue;
      files.push(...listFilesRecursive(fullPath));
      continue;
    }
    if (!/\.(?:ts|tsx|js|cjs|mjs|json)$/i.test(entry.name)) continue;
    files.push(fullPath);
  }
  return files;
}

function findChineseFallbackTerminologyLeaks() {
  const repoRoot = path.resolve(ROOT, '..');
  const scanRoots = [
    path.join(repoRoot, 'DesignEcho-Agent', 'src'),
    path.join(repoRoot, 'DesignEcho-Agent', 'scripts'),
    path.join(repoRoot, 'DesignEcho-UXP', 'src'),
    path.join(repoRoot, 'DesignEcho-UXP', 'scripts')
  ];
  const pattern = new RegExp('\\u515c\\u5e95', 'u');
  const failures = [];
  for (const scanRoot of scanRoots) {
    for (const filePath of listFilesRecursive(scanRoot)) {
      const source = fs.readFileSync(filePath, 'utf8');
      if (!pattern.test(source)) continue;
      const relativePath = path.relative(repoRoot, filePath).replace(/\\/g, '/');
      const lines = source.split(/\r?\n/);
      lines.forEach((line, index) => {
        if (pattern.test(line)) {
          failures.push({
            file: relativePath,
            line: index + 1,
            text: line.trim()
          });
        }
      });
    }
  }
  return failures;
}

function findDefensiveTerminologyLeaks() {
  const repoRoot = path.resolve(ROOT, '..');
  const scanRoots = [
    path.join(repoRoot, 'DesignEcho-Agent', 'src'),
    path.join(repoRoot, 'DesignEcho-Agent', 'scripts'),
    path.join(repoRoot, 'DesignEcho-UXP', 'src'),
    path.join(repoRoot, 'DesignEcho-UXP', 'scripts')
  ];
  const forbiddenPatterns = [
    { label: 'conceptual repair wording', pattern: new RegExp('\\u5bf9\\u6297\\u6027|\\u9632\\u5fa1\\u6027', 'u') },
    { label: 'bypass wording', pattern: new RegExp('\\u7ed5\\u8fc7', 'u') },
    { label: 'unsafe bypass wording', pattern: new RegExp('\\u7ed5\\u8fc7\\s*(?:UXP\\s*)?(?:\\u5b89\\u5168\\u9650\\u5236|\\u6388\\u6743|\\u8def\\u5f84\\u9650\\u5236|\\u6388\\u6743\\u673a\\u5236)', 'u') },
    { label: 'defensive patch wording', pattern: new RegExp('\\u505a\\u9632\\u5fa1', 'u') }
  ];
  const failures = [];
  for (const scanRoot of scanRoots) {
    for (const filePath of listFilesRecursive(scanRoot)) {
      const source = fs.readFileSync(filePath, 'utf8');
      const relativePath = path.relative(repoRoot, filePath).replace(/\\/g, '/');
      const lines = source.split(/\r?\n/);
      lines.forEach((line, index) => {
        for (const item of forbiddenPatterns) {
          if (item.pattern.test(line)) {
            failures.push({
              file: relativePath,
              line: index + 1,
              label: item.label,
              text: line.trim()
            });
          }
        }
      });
    }
  }
  return failures;
}

function findRouteFallbackConceptLeaks() {
  const files = [
    'src/shared/agent-request-lifecycle.ts',
    'src/shared/agent-intent-deliberation-gate.ts',
    'src/renderer/services/design-agent/engine.ts',
    'scripts/smoke-agent-intent-deliberation-gate.cjs'
  ];
  const forbiddenTerms = [
    'deterministic_fallback',
    'model_unavailable_local_fallback',
    'review_fallback_reason',
    'fallbackUsed',
    'readOnlyBypass',
    'isReadOnlyBypass',
    "routeSource: 'fallback'",
    "| 'fallback'"
  ];
  const failures = [];
  for (const file of files) {
    const source = read(file);
    const lines = source.split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const term of forbiddenTerms) {
        if (line.includes(term)) {
          failures.push({
            file,
            line: index + 1,
            term,
            text: line.trim()
          });
        }
      }
    });
  }
  return failures;
}

function assertNoBoundaryFailures(sections) {
  const failures = Object.fromEntries(
    Object.entries(sections).filter(([, entries]) => Array.isArray(entries) && entries.length > 0)
  );
  assert(
    Object.keys(failures).length === 0,
    'User-facing language boundary smoke failed.',
    failures
  );
}

function main() {
  const productPhraseFailures = [];

  for (const file of guardedFiles) {
    const source = read(file);
    for (const phrase of forbiddenProductPhrases) {
      if (source.includes(phrase)) {
        productPhraseFailures.push({ file, phrase });
      }
    }
  }

  const executorMessageLeaks = findExecutorMessageMarkerLeaks();
  const callbackMessageLeaks = findCallbackMessageMarkerLeaks();
  const assistantVisibleMarkerLeaks = findAssistantVisibleMarkerLeaks();
  const sourceMarkerResult = findNonDebugSourceMarkerLeaks();
  const missingDebugOnlyContracts = findMissingDebugOnlyContracts();
  const userHelpDiagnosticsLeaks = findUserHelpDiagnosticsLeaks();
  const skuExecutorInternalProgressLeaks = findSkuExecutorInternalProgressLeaks();
  const longDetailWrappingFailures = findLongDetailWrappingFailures();
  const chineseFallbackTerminologyLeaks = findChineseFallbackTerminologyLeaks();
  const defensiveTerminologyLeaks = findDefensiveTerminologyLeaks();
  const routeFallbackConceptLeaks = findRouteFallbackConceptLeaks();

  assertNoBoundaryFailures({
    productPhraseFailures,
    executorMessageLeaks,
    callbackMessageLeaks,
    assistantVisibleMarkerLeaks,
    nonDebugSourceMarkerLeaks: sourceMarkerResult.leaks,
    missingDebugOnlyContracts,
    userHelpDiagnosticsLeaks,
    skuExecutorInternalProgressLeaks,
    longDetailWrappingFailures,
    chineseFallbackTerminologyLeaks,
    defensiveTerminologyLeaks,
    routeFallbackConceptLeaks
  });

  const workbench = read('src/renderer/components/DesignAgentWorkbench.tsx');
  assert(
    workbench.includes('对话')
      && workbench.includes('素材')
      && !workbench.includes('当前项目')
      && !workbench.includes('当前任务')
      && !workbench.includes('连接与验收')
      && !workbench.includes('交付进度')
      && !workbench.includes('<summary>任务详情</summary>')
      && !workbench.includes('<summary>更多信息</summary>')
      && !workbench.includes('项目结构详情')
      && !workbench.includes('业务素材概览')
      && !workbench.includes('审查线索'),
    'Workbench should keep the default user surface focused on chat and assets only.'
  );

  const packageJson = read('package.json');
  assert(
    packageJson.includes('"smoke:ui:user-facing-language-boundary"'),
    'package should expose smoke:ui:user-facing-language-boundary'
  );

  const messageParser = read('src/renderer/components/message/parser.ts');
  const userVisibleState = read('src/shared/agent-user-visible-state.ts');
  const intentControlPlane = read('src/shared/agent-intent-control-plane.ts');
  assert(
    messageParser.includes('shouldRenderPersistentThinkingSteps')
      && messageParser.includes("requestKind !== 'chat_only'")
      && messageParser.includes("route !== 'direct_response'"),
    'Chat-only direct replies should not render persistent thinking blocks in the default user surface.'
  );

  assert(
    !messageParser.includes("label: '我会避免'")
      && !messageParser.includes("label: '避免'")
      && !messageParser.includes("label: '当前方式'")
      && !messageParser.includes("没看清就下结论"),
    'Visible parser cards should avoid first-person labels and internal preflight table labels.'
  );

  assert(
    !userVisibleState.includes('按方案处理')
      && !userVisibleState.includes('按目标、素材和结果检查点推进')
      && !userVisibleState.includes('处理完成后检查画面和导出结果'),
    'Execution-intent states should not claim the task is being processed before preflight succeeds.'
  );

  assert(
    !userVisibleState.includes('本轮不调用 Photoshop 工具')
      && !userVisibleState.includes('工具处理流程')
      && !userVisibleState.includes('准备执行工具')
      && !userVisibleState.includes('工具任务')
      && !userVisibleState.includes('这是对话或规划讨论，本轮不调用')
      && !userVisibleState.includes('这是对话或规划讨论，我会先把理解和判断说明清楚。')
      && !userVisibleState.includes('需要先补充或确认目标、处理对象和交付结果。')
      && !userVisibleState.includes('我会直接回答这类问题')
      && !userVisibleState.includes('这类问题直接回答')
      && !userVisibleState.includes('直接回答你的问题')
      && !/:\s*'[^']*(?:我会|我可以|我先|我需要)[^']*'/u.test(userVisibleState)
      && userVisibleState.includes('本轮只说明判断，不改动画面')
      && userVisibleState.includes('当前信息不足以确定下一步'),
    'Conversation and clarification states should use status language instead of route labels or assistant-speech templates.'
  );

  assert(
    !/userVisibleSummary:\s*'[^']*(?:我会|我可以|我先|我需要)[^']*'/u.test(intentControlPlane)
      && intentControlPlane.includes("userVisibleSummary: '这是普通对话，直接回复。'")
      && intentControlPlane.includes("userVisibleSummary: '这是能力询问，先说明能做什么。'"),
    'Intent control-plane userVisibleSummary should be status language, not first-person assistant-speech templates.'
  );

  console.log(JSON.stringify({
    success: true,
    checks: [
      'guarded user-facing files do not expose evidence/diagnostic terminology by default',
      'Workbench default surface does not expose the former right rail',
      'structured tool result placeholders do not mention developer diagnostics',
      'layout replication user report uses check result language instead of evidence report language',
      'chat-only direct replies do not render persistent thinking blocks by default',
      'visible parser cards use status labels instead of first-person assistant labels',
      'conversation states use status language instead of assistant-speech templates',
      'intent control-plane summaries use status language instead of first-person assistant templates',
      'business executor result.message values do not expose technical markers',
      'callbacks.onMessage progress strings do not expose internal tool names, service names, paths or debug copy',
      'ChatPanel assistant content and visible message properties do not expose internal markers',
      'debug-only and test-fixture entries are explicitly isolated from normal user-visible text checks',
      'fake model fixture, JSON test samples and ChatPanel test bridge keep their test-only markers identifiable',
      'runtime source and smoke scripts avoid Chinese fallback wording that suggests hidden fail-open behavior',
      'runtime source and smoke scripts avoid adversarial, defensive or unsafe-bypass wording',
      'route lifecycle and deliberation gate use route-source language instead of fallback concepts',
      'package exposes a focused smoke for this boundary'
    ],
    debugOnlyAllowedMarkerHits: sourceMarkerResult.allowed.length
  }, null, 2));
}

main();
