#!/usr/bin/env node

const path = require('path');
require('ts-node').register({ transpileOnly: true, project: path.resolve(__dirname, '..', 'tsconfig.main.json') });

const {
  evaluateDeterministicNonExecutionProtection
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-route-boundary-policy.ts'));
const {
  buildAgentIntentControlPlaneDecision
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-intent-control-plane.ts'));
const {
  matchesSkillRoutingIntent
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'skill-routing.ts'));

function assert(condition, message, details) {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
}

function skuBoundary(overrides = {}) {
  return evaluateDeterministicNonExecutionProtection({
    deterministicSkillId: 'sku-batch',
    requestKind: 'execute_skill',
    executionAuthorization: 'confirmed_tool_required',
    isSkuIntent: true,
    ...overrides
  });
}

function assertSkuSourceClarificationUsesProjectSourcePolicy() {
  const decision = skuBoundary({
    modelRoute: 'clarification_needed',
    modelClarificationQuestion: '要用当前 PSD 里的 SKU 色卡，还是项目 PSD/SKU.psb 作为来源？'
  });

  assert(
    decision.allowed === true,
    'SKU boundary should resolve source-selection clarification through the SKU skill project-source policy.',
    decision
  );
}

function assertGenericClarificationIsStillProtected() {
  const decision = skuBoundary({
    modelRoute: 'clarification_needed',
    modelClarificationQuestion: '需要先明确要处理的目标、具体动作和交付结果，然后才能继续。'
  });

  assert(
    decision.allowed === true,
    'SKU boundary should still protect explicit execution from generic clarification drift.',
    decision
  );
}

function assertCapabilityMenuIsStillProtected() {
  const decision = skuBoundary({
    modelRoute: 'direct_response',
    modelDirectResponse: '我可以协助这些设计工作：主图、点击图、转化图和白底图规划、SKU 组合图和自选备注、详情页设计。你可以直接提出主图、SKU、详情页需求。'
  });

  assert(
    decision.allowed === true,
    'SKU boundary should still protect explicit execution from stale capability-menu text.',
    decision
  );
}

function assertUserRequestedClarificationStaysPaused() {
  const decision = skuBoundary({
    userRequestedClarification: true,
    modelRoute: 'direct_response',
    modelDirectResponse: '当前先不要执行 Photoshop，等你确认 SKU 源文件和规格后再做。'
  });

  assert(
    decision.allowed === false,
    'When the user asked for clarification first, boundary should not force SKU execution.',
    decision
  );
}

function assertSkuCapabilityQuestionStaysConversational() {
  const userInput = '你会做 SKU 吗？';
  const control = buildAgentIntentControlPlaneDecision({
    userInput,
    hasImageInput: false,
    hasDocument: true,
    photoshopConnected: true
  });

  assert(
    control.requestKind === 'chat_only'
      && control.toolScope === 'none'
      && control.shouldUseConversationalPath === true,
    'SKU capability question should stay conversational at the control-plane layer.',
    control
  );
  assert(
    matchesSkillRoutingIntent('sku-batch', userInput) === false,
    'SKU capability question should not match the sku-batch execution skill.',
    { userInput }
  );
}

async function main() {
  const cases = [];
  const tests = [
    ['sku-source-clarification-uses-project-source-policy', assertSkuSourceClarificationUsesProjectSourcePolicy],
    ['generic-clarification-still-protected', assertGenericClarificationIsStillProtected],
    ['capability-menu-still-protected', assertCapabilityMenuIsStillProtected],
    ['user-requested-clarification-stays-paused', assertUserRequestedClarificationStaysPaused],
    ['sku-capability-question-stays-conversational', assertSkuCapabilityQuestionStaysConversational]
  ];

  for (const [name, fn] of tests) {
    try {
      await fn();
      cases.push({ name, status: 'pass' });
    } catch (error) {
      cases.push({
        name,
        status: 'fail',
        message: error.message,
        details: error.details
      });
    }
  }

  const payload = {
    success: cases.every((item) => item.status === 'pass'),
    cases
  };
  console.log(JSON.stringify(payload, null, 2));
  if (!payload.success) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
