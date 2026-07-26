#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function section(source, selector) {
  const pattern = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([\\s\\S]*?)\\n\\}`, 'm');
  const match = source.match(pattern);
  assert(match, `Missing CSS section: ${selector}`);
  return match[1];
}

function main() {
  const cardBlock = read('src/renderer/components/message/blocks/CardBlock.tsx');
  const toolResultBlock = read('src/renderer/components/message/blocks/ToolResultBlock.tsx');
  const css = read('src/renderer/components/message/MessageRenderer.css');

  assert(!/[ℹ️✅⚠️❌📋]/u.test(cardBlock), 'status cards should use quiet text symbols instead of emoji icons.');
  assert(toolResultBlock.includes("useState(block.success === false"), 'tool result details should stay quiet by default and expand automatically on failures.');

  const cardSuccess = section(css, '.card-block.card-success');
  const cardInfo = section(css, '.card-block.card-info');
  const cardWarning = section(css, '.card-block.card-warning');
  const toolHeader = section(css, '.tool-result-header');
  const thinkingBlock = section(css, '.thinking-block');

  assert(!/linear-gradient/i.test(cardSuccess + cardInfo + cardWarning), 'status cards should not use large colored gradient backgrounds.');
  assert(/background:\s*transparent;/.test(cardSuccess), 'success cards should be visually quiet.');
  assert(!/var\(--de-shadow\)/.test(toolHeader), 'tool result headers should not use heavy panel backgrounds.');
  assert(/background:\s*transparent;/.test(thinkingBlock), 'thinking blocks should be a lightweight disclosure row, not a heavy card.');
  assert(/border:\s*none;/.test(thinkingBlock), 'thinking blocks should not render as bordered panels.');

  console.log('smoke-chat-ui-lite-status-style: 5/5 checks passed');
}

main();
