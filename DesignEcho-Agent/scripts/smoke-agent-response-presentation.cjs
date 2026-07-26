#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const repoRoot = path.resolve(__dirname, '..');
const {
  AGENT_RESPONSE_PRESENTATION_PROMPT,
  isStructuredAgentResponseContent,
  normalizeAgentResponsePresentation
} = require(path.join(repoRoot, 'src/shared/agent-response-presentation.ts'));
const {
  parseMessageMarkdown
} = require(path.join(repoRoot, 'src/renderer/components/message/markdown.ts'));

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

const compactNumberedReply = '找到 5 个可能的目标图层，需要确认： 1. 文案层 2. 产品首屏 3. 中央图标 4. 卖点组 5. 参数区';
const normalizedNumberedReply = normalizeAgentResponsePresentation(compactNumberedReply);
assert(
  normalizedNumberedReply.includes('\n\n1. 文案层\n2. 产品首屏\n3. 中央图标\n4. 卖点组\n5. 参数区'),
  'three or more sequential inline items should recover visible list boundaries'
);
assert(
  isStructuredAgentResponseContent(normalizedNumberedReply),
  'a recovered numbered list should be marked as structured presentation'
);

const measurementText = '画布比例为 1.5，字号比例为 2.0，行距建议 1.6。';
assert.strictEqual(
  normalizeAgentResponsePresentation(measurementText),
  measurementText,
  'decimals and measurements must not be rewritten as lists'
);

const shortReply = '可以，我会先看当前画面。';
assert.strictEqual(
  isStructuredAgentResponseContent(shortReply),
  false,
  'short conversational replies should remain compact'
);

const markdown = [
  '## 模板结构说明',
  '',
  '这个模板包含以下模块：',
  '',
  '### 1. 首屏区域',
  '',
  '- 品牌标识与大促横幅',
  '- 产品主图轮播展示',
  '',
  '### 2. 核心卖点区',
  '',
  '- 四个核心优势',
  '- 简洁卖点文案',
  '',
  '---',
  '',
  '可根据实际产品替换内容。'
].join('\n');
const html = parseMessageMarkdown(markdown);
assert(html.includes('<h3>模板结构说明</h3>'), 'title heading should render as its own block');
assert(html.includes('<h4>1. 首屏区域</h4>'), 'numbered section heading should render as its own block');
assert.strictEqual((html.match(/<ul>/g) || []).length, 2, 'separate bullet groups must remain separate lists');
assert(html.includes('<hr />'), 'divider should render as a semantic horizontal rule');

const orderedHtml = parseMessageMarkdown('1. 文案层\n2. 产品首屏\n3. 参数区');
assert(orderedHtml.includes('<ol>'), 'ordered items should be wrapped in an ordered list');
assert.strictEqual((orderedHtml.match(/<li>/g) || []).length, 3, 'ordered list should preserve every item');

const unsafeHtml = parseMessageMarkdown('<script>alert(1)</script> [危险](javascript:alert(1))');
assert(!unsafeHtml.includes('<script>'), 'raw HTML must be escaped');
assert(!unsafeHtml.includes('href="javascript:'), 'unsafe link protocols must not become clickable links');

const conversationalSource = read('src/renderer/services/agent-orchestration/conversational.ts');
const autonomousSource = read('src/renderer/services/skill-executors/autonomous-agent.executor.ts');
const rendererSource = read('src/renderer/components/message/MessageRenderer.tsx');
const workbenchCss = read('src/renderer/components/DesignAgentWorkbench.css');
assert(
  conversationalSource.includes('AGENT_RESPONSE_PRESENTATION_PROMPT')
    && autonomousSource.includes('AGENT_RESPONSE_PRESENTATION_PROMPT'),
  'conversation and execution replies must share one presentation contract'
);
assert(
  !conversationalSource.includes("'不要使用 Markdown。'"),
  'the conversation prompt must not globally forbid structured Markdown'
);
assert(
  rendererSource.includes('isStructuredAgentResponseContent')
    && rendererSource.includes('structured-response'),
  'MessageRenderer should derive structured styling from content semantics'
);
assert(
  workbenchCss.includes('.multimodal-message.assistant.structured-response'),
  'the narrow Agent rail should provide a dedicated readable surface for structured replies'
);
assert(
  AGENT_RESPONSE_PRESENTATION_PROMPT.includes('不套固定模板')
    && AGENT_RESPONSE_PRESENTATION_PROMPT.includes('禁止把'),
  'the shared contract should stay adaptive and reject inline numbered walls of text'
);

console.log('Agent response presentation smoke passed.');
