#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const ts = require('typescript');

const ROOT = path.resolve(__dirname, '..');
const SUMMARY_PATH = path.join(ROOT, 'src/renderer/services/agent-orchestration/chat-error-summary.ts');
const CHAT_PANEL_PATH = path.join(ROOT, 'src/renderer/components/ChatPanel.tsx');

function loadSummaryExports() {
  const source = fs.readFileSync(SUMMARY_PATH, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true
    },
    fileName: SUMMARY_PATH
  });

  const summaryModule = new Module(SUMMARY_PATH, module);
  summaryModule.filename = SUMMARY_PATH;
  summaryModule.paths = Module._nodeModulePaths(path.dirname(SUMMARY_PATH));
  summaryModule._compile(compiled.outputText, `${SUMMARY_PATH}.js`);
  return summaryModule.exports;
}

const { summarizeChatError, compactChatError } = loadSummaryExports();
const chatPanel = fs.readFileSync(CHAT_PANEL_PATH, 'utf8');

const quotaError = 'Error invoking remote method model:chatWithTools: Error: [GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-preview:generateContent: [429 Too Many Requests] You exceeded your current quota. Quota exceeded for metric generate_content_free_tier_requests. Please retry in 40s. [{"@type":"type.googleapis.com/google.rpc.Help","links":[{"url":"https://ai.google.dev/gemini-api/docs/rate-limits"}]}]';
const quotaSummary = summarizeChatError(new Error(quotaError), { isCloud: true });

assert(
  quotaSummary.includes('模型额度或限流已触发'),
  'quota and 429 provider errors must be shown as quota/rate-limit failures'
);
assert(
  quotaSummary.includes('429') || quotaSummary.toLowerCase().includes('quota'),
  'quota summary must keep the compact provider cause'
);
assert(
  !quotaSummary.includes('"@type"') && !quotaSummary.includes('google.rpc.Help'),
  'quota summary must not expose raw provider diagnostic JSON'
);
assert(
  quotaSummary.length < 340,
  'quota summary must stay compact enough for user-facing chat'
);

const syntheticApiKey = ['sk', 'test_should_not_leak_1234567890'].join('-');
const keySummary = summarizeChatError(
  `401 Unauthorized: Authorization: Bearer ${syntheticApiKey}`,
  { isCloud: true }
);
assert(keySummary.includes('API 密钥或账号权限错误'), 'auth errors must keep auth-specific wording');
assert(!keySummary.includes(syntheticApiKey), 'auth summary must redact secret-looking values');

const compact = compactChatError('fetch failed after network timeout');
assert(compact === 'fetch failed after network timeout', 'compactChatError should preserve short useful errors');

assert(
  chatPanel.includes("import { summarizeChatError } from '../services/agent-orchestration/chat-error-summary';"),
  'ChatPanel must use the shared chat error summarizer'
);
assert(
  chatPanel.includes('const errorMsg = summarizeChatError(error, { isCloud });'),
  'ChatPanel must build final error messages through summarizeChatError'
);
assert(
  !chatPanel.includes('Google AI 连接失败，请检查 API 密钥。'),
  'ChatPanel must not collapse all Gemini failures into a misleading API-key message'
);

console.log(JSON.stringify({
  success: true,
  checks: [
    'quota and 429 errors remain visible as compact user-facing causes',
    'raw provider diagnostic JSON is removed from chat errors',
    'secret-looking values are redacted',
    'ChatPanel uses the shared chat error summary helper'
  ]
}, null, 2));
