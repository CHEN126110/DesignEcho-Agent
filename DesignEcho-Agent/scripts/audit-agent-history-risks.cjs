#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const agentRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(agentRoot, '..');

const checks = [];
const warnings = [];
const errors = [];

function read(relativePath, baseDir = agentRoot) {
  return fs.readFileSync(path.resolve(baseDir, relativePath), 'utf8');
}

function exists(relativePath, baseDir = agentRoot) {
  return fs.existsSync(path.resolve(baseDir, relativePath));
}

function record(id, status, detail) {
  checks.push({ id, status, detail });
}

function fail(id, detail) {
  errors.push({ id, detail });
  record(id, 'failed', detail);
}

function pass(id, detail) {
  record(id, 'passed', detail);
}

function warn(id, detail) {
  warnings.push({ id, detail });
  record(id, 'warning', detail);
}

function assertIncludes(content, expected, id, detail) {
  if (!content.includes(expected)) {
    fail(id, detail || `Missing required marker: ${expected}`);
    return false;
  }
  return true;
}

function assertNotIncludes(content, forbidden, id, detail) {
  if (content.includes(forbidden)) {
    fail(id, detail || `Forbidden marker still exists: ${forbidden}`);
    return false;
  }
  return true;
}

function listFilesRecursive(rootDir, predicate) {
  const result = [];
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'tmp') continue;
      result.push(...listFilesRecursive(fullPath, predicate));
      continue;
    }
    if (!predicate || predicate(fullPath)) {
      result.push(fullPath);
    }
  }
  return result;
}

function checkCurrentAgentSourceOfTruth() {
  const id = 'current-agent-source-of-truth';
  const legacyPromptPath = path.resolve(agentRoot, 'src/renderer/prompts/agent-system-prompt.ts');
  const facadePath = 'src/renderer/services/unified-agent.service.ts';
  const facade = read(facadePath);
  const sourceFiles = listFilesRecursive(path.resolve(agentRoot, 'src'), (filePath) => (
    /\.(ts|tsx|js|jsx)$/.test(filePath)
      && path.resolve(filePath) !== legacyPromptPath
  ));

  let ok = true;
  const legacyPromptImports = [];
  for (const filePath of sourceFiles) {
    const content = fs.readFileSync(filePath, 'utf8');
    if (/agent-system-prompt/.test(content)) {
      legacyPromptImports.push(path.relative(agentRoot, filePath).replace(/\\/g, '/'));
    }
  }

  if (legacyPromptImports.length > 0) {
    fail(
      id,
      `Legacy renderer agent-system-prompt must not be imported by current runtime files: ${legacyPromptImports.join(', ')}`
    );
    ok = false;
  }

  ok = assertIncludes(
    facade,
    "from './agent-orchestration'",
    id,
    `${facadePath} must remain a compatibility facade over the current agent-orchestration source of truth.`
  ) && ok;
  ok = assertNotIncludes(
    facade,
    'getAgentSystemPromptTemplate',
    id,
    `${facadePath} must not revive the legacy JSON-decision prompt.`
  ) && ok;
  ok = assertNotIncludes(
    facade,
    'class UnifiedAgent',
    id,
    `${facadePath} must not reintroduce a parallel legacy Agent implementation.`
  ) && ok;

  const legacyPrompt = read('src/renderer/prompts/agent-system-prompt.ts');
  ok = assertIncludes(
    legacyPrompt,
    '历史兼容文件',
    id,
    'Legacy renderer prompt must be explicitly marked as historical compatibility material.'
  ) && ok;
  ok = assertIncludes(
    legacyPrompt,
    'src/renderer/services/agent-orchestration + src/renderer/services/design-agent/engine.ts',
    id,
    'Legacy renderer prompt must point contributors to the current Agent runtime source of truth.'
  ) && ok;
  [
    '只输出最终决策 JSON',
    '请用 JSON 格式输出你的决策',
    '"type": "tool_call"',
    '"skill_execution"',
    '"direct_response"',
    '"clarification_needed"',
    '行动优先',
    '能做就做，不要问问题',
    '始终返回 JSON'
  ].forEach((forbidden) => {
    ok = assertNotIncludes(
      legacyPrompt,
      forbidden,
      id,
      `Legacy renderer prompt must not contain old route-output or forced-execution instruction: ${forbidden}`
    ) && ok;
  });

  if (ok) {
    pass(
      id,
      'Current Agent runtime source of truth is agent-orchestration + DesignAgentEngine; legacy renderer prompt is not imported and no longer carries old JSON-route instructions.'
    );
  }
}

function checkRouteStatusMessageNaming() {
  const legacyFieldName = 'thinking' + 'Messages';
  const files = [
    'src/shared/types/skill.types.ts',
    'src/shared/skills/skill-declarations.ts',
    'src/renderer/services/agent-orchestration/routing.ts'
  ];

  let ok = true;
  for (const file of files) {
    const content = read(file);
    ok = assertIncludes(
      content,
      'routeStatusMessages',
      'route-status-message-naming',
      `${file} must use routeStatusMessages instead of legacy thinking wording.`
    ) && ok;
    ok = assertNotIncludes(
      content,
      legacyFieldName,
      'route-status-message-naming',
      `${file} still contains legacy thinking wording for deterministic route status.`
    ) && ok;
  }

  if (ok) {
    pass('route-status-message-naming', 'Deterministic route copy is named as status, not model thinking.');
  }
}

function checkVisibleFeedbackBoundary() {
  const chatPanel = read('src/renderer/components/ChatPanel.tsx');
  const policy = read('src/shared/agent-observation-channels.ts');
  const forbiddenLocalCopies = ['等待响应', '请求已发送', '正在准备', '稍等，正在准备'];

  let ok = true;
  ok = assertIncludes(
    chatPanel,
    'classifyAgentObservationChannel',
    'visible-feedback-boundary',
    'ChatPanel must classify model-visible content before adding thinking steps.'
  ) && ok;
  ok = assertIncludes(
    chatPanel,
    'canObservationEnterThinkingSteps',
    'visible-feedback-boundary',
    'ChatPanel must gate thinking-step rendering through observation channel policy.'
  ) && ok;
  ok = assertIncludes(
    policy,
    "input.source === 'local_placeholder'",
    'visible-feedback-boundary',
    'Observation policy must explicitly block local placeholders.'
  ) && ok;
  ok = assertIncludes(
    policy,
    'Local waiting/preparing placeholders must not be shown as model thinking.',
    'visible-feedback-boundary',
    'Observation policy must document why local placeholders are blocked.'
  ) && ok;

  for (const copy of forbiddenLocalCopies) {
    ok = assertNotIncludes(
      chatPanel,
      copy,
      'visible-feedback-boundary',
      `ChatPanel must not hardcode local waiting copy: ${copy}`
    ) && ok;
  }

  if (ok) {
    pass('visible-feedback-boundary', 'ChatPanel and observation policy keep local placeholders out of thinking UI.');
  }
}

function checkDirectExecutorDisclosure() {
  const shared = read('src/shared/ecommerce-socks-design.ts');
  const executor = read('src/renderer/services/skill-executors/ecommerce-socks-design.executor.ts');
  const smoke = read('scripts/smoke-ecommerce-socks-design-child-dispatch-runner.cjs');

  let ok = true;
  ok = assertNotIncludes(
    shared,
    "'direct_executor'",
    'direct-executor-disclosure',
    'Shared ecommerce child dispatch evidence must not expose direct_executor as an accepted path.'
  ) && ok;
  ok = assertNotIncludes(
    shared,
    'child_dispatch_currently_uses_direct_executor_path',
    'direct-executor-disclosure',
    'Shared ecommerce child dispatch evidence must not preserve the old direct executor warning.'
  ) && ok;
  ok = assertIncludes(
    smoke,
    "childExecutionPath === 'unified_executor'",
    'direct-executor-disclosure',
    'Smoke must assert that real child dispatch routes through the unified executor wrapper.'
  ) && ok;
  ok = assertIncludes(
    executor,
    'executeParams.runSkill',
    'direct-executor-disclosure',
    'Parent ecommerce skill must call the injected unified skill runner instead of static child executors.'
  ) && ok;

  if (ok) {
    pass(
      'direct-executor-disclosure',
      'Parent ecommerce child dispatch now uses the injected unified executor path.'
    );
  }
}

function checkPhotoshopMoveModalGuard() {
  const moveToolPath = 'DesignEcho-UXP/src/tools/layout/move-layer.ts';
  if (!exists(moveToolPath, repoRoot)) {
    fail('photoshop-move-modal-guard', `${moveToolPath} is missing.`);
    return;
  }

  const moveTool = read(moveToolPath, repoRoot);
  let ok = true;
  ok = assertIncludes(
    moveTool,
    'translateLayer',
    'photoshop-move-modal-guard',
    'moveLayer must use DOM translate instead of Photoshop native move.'
  ) && ok;
  if (/_obj:\s*['"]move['"]/.test(moveTool)) {
    fail(
      'photoshop-move-modal-guard',
      'moveLayer must not call Photoshop native move because it can trigger a native availability popup.'
    );
    ok = false;
  }
  if (moveTool.includes("modalBehavior: 'execute'") || moveTool.includes('modalBehavior: "execute"')) {
    fail(
      'photoshop-move-modal-guard',
      'moveLayer must not pass modalBehavior execute inside executeAsModal batchPlay calls.'
    );
    ok = false;
  }
  if (moveTool.includes("modalBehavior: 'fail'") || moveTool.includes('modalBehavior: "fail"')) {
    fail(
      'photoshop-move-modal-guard',
      'moveLayer must not pass modalBehavior fail inside executeAsModal batchPlay calls.'
    );
    ok = false;
  }

  if (ok) {
    pass('photoshop-move-modal-guard', 'moveLayer uses DOM translate and avoids Photoshop native move popups.');
  }
}

function checkPhotoshopNestedModalBehaviorGuard() {
  const id = 'photoshop-nested-modal-behavior-guard';
  const guardedFiles = [
    'DesignEcho-UXP/src/core/jsx-bridge.ts',
    'DesignEcho-UXP/src/tools/image/get-subject-bounds.ts',
    'DesignEcho-UXP/src/tools/layer/layer-effects.ts',
    'DesignEcho-UXP/src/tools/layer/layer-properties.ts',
    'DesignEcho-UXP/src/tools/layout/move-layer.ts',
    'DesignEcho-UXP/src/tools/layout/sku-layout-tool.ts',
    'DesignEcho-UXP/src/tools/layout/template-tool.ts'
  ];

  let ok = true;
  for (const file of guardedFiles) {
    if (!exists(file, repoRoot)) {
      fail(id, `${file} is missing.`);
      ok = false;
      continue;
    }

    const source = read(file, repoRoot);
    ok = assertIncludes(
      source,
      'executeAsModal',
      id,
      `${file} must stay covered by executeAsModal modal-scope guard.`
    ) && ok;
    if (file === 'DesignEcho-UXP/src/tools/layout/move-layer.ts') {
      ok = assertIncludes(
        source,
        'translateLayer',
        id,
        `${file} must use DOM translate instead of Photoshop native move.`
      ) && ok;
      if (/_obj:\s*['"]move['"]/.test(source)) {
        fail(id, `${file} must not call Photoshop native move.`);
        ok = false;
      }
      continue;
    }
    ok = assertIncludes(
      source,
      'synchronousExecution: true',
      id,
      `${file} must use synchronous batchPlay execution in modal scopes.`
    ) && ok;
    ok = assertIncludes(
      source,
      "dialogOptions: 'dontDisplay'",
      id,
      `${file} must suppress Photoshop native dialogs at descriptor level.`
    ) && ok;
    ok = assertNotIncludes(
      source,
      "modalBehavior: 'execute'",
      id,
      `${file} must not pass modalBehavior execute inside executeAsModal.`
    ) && ok;
    ok = assertNotIncludes(
      source,
      "modalBehavior: 'fail'",
      id,
      `${file} must not pass modalBehavior fail inside executeAsModal.`
    ) && ok;
  }

  if (ok) {
    pass(id, 'Guarded Photoshop tools avoid nested modalBehavior and keep synchronous no-dialog batchPlay.');
  }
}

function checkPowerShellAndEncodingGuard() {
  const rootAgents = exists('AGENTS.md', repoRoot) ? read('AGENTS.md', repoRoot) : '';
  const agentAgents = exists('AGENTS.md') ? read('AGENTS.md') : '';
  const agentsText = `${rootAgents}\n${agentAgents}`;
  const hygiene = read('scripts/validate-maintenance-hygiene.cjs');

  let ok = true;
  ok = assertIncludes(
    agentsText,
    'pwsh -NoLogo -NoProfile -Command',
    'powershell-and-encoding-guard',
    'AGENTS.md must preserve the PowerShell 7 command convention.'
  ) && ok;
  ok = assertIncludes(
    hygiene,
    'MOJIBAKE_PATTERNS',
    'powershell-and-encoding-guard',
    'Maintenance validation must keep mojibake scanning enabled.'
  ) && ok;
  ok = assertIncludes(
    hygiene,
    'assertNoMojibake',
    'powershell-and-encoding-guard',
    'Maintenance validation must run the mojibake guard.'
  ) && ok;

  if (ok) {
    pass('powershell-and-encoding-guard', 'PowerShell convention and mojibake guard are present.');
  }
}

function checkEcommerceCompletionSemantics() {
  const executor = read('src/renderer/services/skill-executors/ecommerce-socks-design.executor.ts');
  let ok = true;
  ok = assertIncludes(
    executor,
    'realDispatchFailed',
    'ecommerce-completion-semantics',
    'Parent ecommerce executor must explicitly downgrade failed child dispatch.'
  ) && ok;
  ok = assertIncludes(
    executor,
    'resultSuccess',
    'ecommerce-completion-semantics',
    'Parent ecommerce executor must derive AgentResult.success from child dispatch status.'
  ) && ok;
  ok = assertIncludes(
    executor,
    '不声明整套设计质量完成',
    'ecommerce-completion-semantics',
    'Parent ecommerce executor must not claim whole design quality completion.'
  ) && ok;

  if (ok) {
    pass('ecommerce-completion-semantics', 'Parent ecommerce skill has explicit failure and non-completion semantics.');
  }
}

function checkGeneralAgentIdentityBoundary() {
  const files = [
    'src/shared/prompts/agent-prompt.ts',
    'src/shared/prompts/enhanced-agent-prompt.ts',
    'src/shared/prompts/reference-analysis.ts',
    'src/shared/prompts/visual-understanding.ts',
    'src/renderer/components/ChatPanel.tsx',
    'src/shared/knowledge/socks-categories.ts',
    'src/renderer/services/skill-executors/project-image-analysis.executor.ts'
  ];

  let ok = true;
  const forbiddenPhrases = [
    '专业' + '电商设计智能体',
    '资深' + '电商视觉设计专家',
    '资深' + '电商设计分析专家',
    '电商设计' + ' Agent',
    'e-commerce design' + ' agent'
  ];

  for (const file of files) {
    const content = read(file);
    for (const phrase of forbiddenPhrases) {
      ok = assertNotIncludes(
        content,
        phrase,
        'general-agent-identity-boundary',
        `${file} must not define DesignEcho top-level identity as ecommerce-only.`
      ) && ok;
    }
  }

  const agentPrompt = read('src/shared/prompts/agent-prompt.ts');
  ok = assertIncludes(
    agentPrompt,
    '通用 Photoshop 设计 Agent',
    'general-agent-identity-boundary',
    'Agent prompt must define DesignEcho as a general Photoshop design Agent.'
  ) && ok;
  ok = assertIncludes(
    agentPrompt,
    '电商、品牌、平面、社媒与商业视觉场景',
    'general-agent-identity-boundary',
    'Agent prompt may list ecommerce only as one business scenario, not identity.'
  ) && ok;
  ok = assertIncludes(
    read('src/renderer/components/ChatPanel.tsx'),
    '通用 Photoshop 设计 Agent',
    'general-agent-identity-boundary',
    'ChatPanel welcome copy must expose the general Photoshop design Agent identity.'
  ) && ok;

  if (ok) {
    pass(
      'general-agent-identity-boundary',
      'Top-level prompts define DesignEcho as a general Photoshop design Agent, with ecommerce as a scenario only.'
    );
  }
}

checkRouteStatusMessageNaming();
checkVisibleFeedbackBoundary();
checkDirectExecutorDisclosure();
checkPhotoshopMoveModalGuard();
checkPhotoshopNestedModalBehaviorGuard();
checkPowerShellAndEncodingGuard();
checkEcommerceCompletionSemantics();
checkGeneralAgentIdentityBoundary();
checkCurrentAgentSourceOfTruth();

const report = {
  success: errors.length === 0,
  checks,
  warnings,
  errors
};

console.log(JSON.stringify(report, null, 2));

if (errors.length > 0) {
  process.exit(1);
}
