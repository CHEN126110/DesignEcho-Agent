#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function read(relativePath) {
  return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function main() {
  const executor = read('src/renderer/services/tool-executor.service.ts');
  const block = read('src/renderer/components/message/blocks/ToolResultBlock.tsx');
  const parser = read('src/renderer/components/message/parser.ts');
  const logger = read('src/renderer/services/tool-logger.ts');
  const toolDisplayInfo = read('src/renderer/services/tool-display-info.ts');
  const chatPanel = read('src/renderer/components/ChatPanel.tsx');

  assert(
    !executor.includes('textParts.push(`[${toolName}] 结果:\\n${JSON.stringify(result, null, 2)}`)'),
    'processToolResults must not append full JSON result into model context'
  );
  assert(
    executor.includes('summarizeToolResultForModel(result)'),
    'processToolResults should use safe model summary'
  );
  assert(
    executor.includes("from '../../shared/chat-response-cleaner'") &&
      executor.includes('normalizeFailedToolResultForPublicUse') &&
      executor.includes('sanitizeForToolSummary(result.error') &&
      executor.includes('sanitizeUserVisibleDiagnosticText(errorMessage)'),
    'tool executor failures and model summaries must pass through shared user-visible diagnostic cleaning'
  );
  assert(
    !block.includes('JSON.stringify(value, null, 2)'),
    'ToolResultBlock must not render raw object JSON in normal UI'
  );
  assert(
    block.includes('结构化结果已隐藏') && block.includes('对象数据已隐藏'),
    'ToolResultBlock should hide structured/raw object results'
  );
  assert(
    parser.includes("typeof data.acceptance?.summaryText === 'string'") &&
      parser.includes("if (key === 'acceptance') continue;"),
    'message parser should expose acceptance summary and skip raw acceptance object'
  );
  assert(
    parser.includes('PUBLIC_TOOL_RESULT_FIELD_MAP') &&
      parser.includes('if (!label) continue;') &&
      !parser.includes('const label = fieldMap[key] || key;'),
    'message parser must use a public tool-result field allowlist instead of rendering arbitrary result keys'
  );
  assert(
    !parser.includes("label: '重试工具'") &&
      !parser.includes("action: 'runTool'") &&
      !parser.includes('sanitizeRetryToolParams(step.toolParams'),
    'normal tool-result cards must not expose retry-tool actions or carry raw tool params in the user surface'
  );
  assert(
    !parser.includes("'rawPayloadRedacted':") &&
      !parser.includes("'source_hint':") &&
      !parser.includes("'direct_response':") &&
      !parser.includes("'clarification_needed':"),
    'public tool-result field labels must not allow internal diagnostic/status keys'
  );
  assert(
    logger.includes('参数摘要') && !logger.includes('JSON.stringify(call.params).substring'),
    'debug report should show redacted parameter summary instead of raw params'
  );
  assert(
    toolDisplayInfo.includes('createSkuPlaceholders') &&
      toolDisplayInfo.includes('exportColorConfig') &&
      toolDisplayInfo.includes('getSkuPlaceholders'),
    'SKU setup tools must have user-facing display names instead of falling back to raw tool ids'
  );
  assert(
    toolDisplayInfo.includes('normalizeToolDisplayLookupName') &&
      !toolDisplayInfo.includes('name: toolName,'),
    'unknown or suffixed tool ids must not be displayed directly in the normal user surface'
  );
  assert(
    !chatPanel.includes('sanitizeTestSnapshotToken((step as any).toolName)'),
    'ChatPanel test snapshot must not treat raw thinking step toolName values as visible text'
  );

  console.log(JSON.stringify({
    success: true,
    checks: [
      'model context uses summarized tool results',
      'normal tool result UI hides raw structured data',
      'parser exposes acceptance summary only',
      'parser allowlists public tool-result detail fields',
      'normal tool result UI does not expose retry-tool actions',
      'debug report uses parameter summary'
      , 'tool display names hide raw internal tool ids'
    ]
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
