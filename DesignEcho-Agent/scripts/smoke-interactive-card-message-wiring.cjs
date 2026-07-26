#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const messageTypes = fs.readFileSync(
  path.resolve(__dirname, '../src/renderer/components/message/types.ts'),
  'utf8',
);
const renderer = fs.readFileSync(
  path.resolve(__dirname, '../src/renderer/components/message/MessageRenderer.tsx'),
  'utf8',
);
const chatPanel = fs.readFileSync(
  path.resolve(__dirname, '../src/renderer/components/ChatPanel.tsx'),
  'utf8',
);
const toolExecutor = fs.readFileSync(
  path.resolve(__dirname, '../src/renderer/services/tool-executor.service.ts'),
  'utf8',
);
const toolSchemas = fs.readFileSync(
  path.resolve(__dirname, '../src/renderer/services/agent-runtime/tool-schemas.ts'),
  'utf8',
);
const parser = fs.readFileSync(
  path.resolve(__dirname, '../src/renderer/components/message/parser.ts'),
  'utf8',
);
const blockIndex = fs.readFileSync(
  path.resolve(__dirname, '../src/renderer/components/message/blocks/index.ts'),
  'utf8',
);

assert(messageTypes.includes("'interactive_card'"), 'message type union should include interactive_card');
assert(messageTypes.includes('InteractiveCardBlock'), 'message types should expose InteractiveCardBlock');
assert(renderer.includes('InteractiveCardBlock'), 'MessageRenderer should render InteractiveCardBlock');
assert(parser.includes('interactiveCards'), 'parser should convert legacy interactiveCards into content blocks');
assert(blockIndex.includes('InteractiveCardBlock'), 'message blocks index should export InteractiveCardBlock');
assert(chatPanel.includes("case 'submitInteractiveCard'"), 'ChatPanel should handle interactive card submissions');
assert(
  /failureContent[\s\S]*interactiveCards[\s\S]*addLocalAssistantMessage/.test(chatPanel),
  'ChatPanel failure/blocker messages should preserve interactiveCards so confirmation cards render when a task needs user input'
);
assert(toolExecutor.includes("name: 'createInteractiveCard'"), 'AVAILABLE_TOOLS should expose createInteractiveCard');
assert(toolExecutor.includes("toolName === 'createInteractiveCard'"), 'executeToolCall should implement createInteractiveCard');
assert(toolSchemas.includes("name: 'createInteractiveCard'"), 'agent runtime tool schemas should expose createInteractiveCard');

console.log('[smoke-interactive-card-message-wiring] pass');
