#!/usr/bin/env node
/**
 * 摸底②：只读链路实测（经 8768 MCP HTTP 端点驱动真实 Photoshop）
 *
 * 边界：只读。不写 Photoshop、不创建文档、不保存导出。
 * 产出：tmp/probe-readonly-live/report.json + 控制台摘要。
 */
const fs = require('fs');
const path = require('path');

const MCP_ENDPOINT = process.env.DESIGNECHO_MCP_ENDPOINT || 'http://127.0.0.1:8768/mcp';
const TIMEOUT_MS = 20000;

async function rpc(method, params = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response;
  try {
    response = await fetch(MCP_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({ jsonrpc: '2.0', id: Date.now() + Math.random(), method, params })
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error(`${method} 超时（${TIMEOUT_MS}ms）`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.error) throw new Error(`${method} 失败: ${JSON.stringify(payload.error)}`);
  return payload.result;
}

function parseToolResult(result) {
  const text = result?.content?.find((c) => c?.type === 'text')?.text;
  if (typeof text !== 'string') return result;
  try { return JSON.parse(text); } catch { return text; }
}

async function callMcpTool(name, args = {}) {
  return parseToolResult(await rpc('tools/call', { name, arguments: args }));
}

/** Photoshop 原子工具经 photoshop.tools.call 包装器调用 */
async function callTool(name, args = {}) {
  const value = await callMcpTool('photoshop.tools.call', { name, arguments: args });
  if (value && typeof value === 'object' && 'result' in value && Object.keys(value).length <= 3) {
    return value.result;
  }
  return value;
}

function summarize(value, depth = 0) {
  if (value == null) return value;
  if (typeof value === 'string') {
    return value.length > 200 ? `${value.slice(0, 200)}…(共${value.length}字符)` : value;
  }
  if (Array.isArray(value)) {
    const head = value.slice(0, 8).map((v) => summarize(v, depth + 1));
    return value.length > 8 ? [...head, `…(共${value.length}项)`] : head;
  }
  if (typeof value === 'object') {
    if (depth >= 5) return '…(已达摘要深度)';
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = summarize(v, depth + 1);
    return out;
  }
  return value;
}

async function step(report, name, fn) {
  const startedAt = Date.now();
  try {
    const value = await fn();
    report.steps.push({ name, ok: true, ms: Date.now() - startedAt, summary: summarize(value) });
    console.log(`✅ ${name} (${Date.now() - startedAt}ms)`);
    return value;
  } catch (error) {
    report.steps.push({ name, ok: false, ms: Date.now() - startedAt, error: String(error?.message || error) });
    console.log(`❌ ${name}: ${error?.message || error}`);
    return null;
  }
}

async function main() {
  const report = {
    generatedAt: new Date().toISOString(),
    mode: 'read-only-live-probe',
    endpoint: MCP_ENDPOINT,
    boundaries: { readOnly: true, writesPhotoshop: false, createsDocument: false },
    steps: []
  };

  const toolsList = await step(report, 'MCP tools/list', async () => {
    const result = await rpc('tools/list');
    const names = (result?.tools || []).map((t) => t.name);
    return { count: names.length, names };
  });

  const docs = await step(report, 'listDocuments', () => callTool('listDocuments'));

  const docInfo = await step(report, 'getDocumentInfo', () => callTool('getDocumentInfo'));

  await step(report, 'getLayerHierarchy', async () => {
    const value = await callTool('getLayerHierarchy');
    const layers = value?.layers || value?.hierarchy || value;
    const count = Array.isArray(layers) ? layers.length : undefined;
    return { topLevelCount: count, sample: summarize(layers) };
  });

  await step(report, 'getAllTextLayers', () => callTool('getAllTextLayers'));

  await step(report, 'photoshop.acceptance_snapshot（仅校验图像存在，不存原图）', async () => {
    const value = await callMcpTool('photoshop.acceptance_snapshot', {});
    const json = JSON.stringify(value);
    const hasImage = /base64|"image"|dataUrl/i.test(json);
    return { hasImage, payloadChars: json.length, keys: value && typeof value === 'object' ? Object.keys(value) : null };
  });

  await step(report, 'analyzeLayout', () => callTool('analyzeLayout'));

  await step(report, 'runtime.get_active_context', () => callMcpTool('runtime.get_active_context', {}));

  await step(report, 'system.status', () => callMcpTool('system.status', {}));

  const reportDir = path.join(__dirname, '..', 'tmp', 'probe-readonly-live');
  fs.mkdirSync(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, 'report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');

  const okCount = report.steps.filter((s) => s.ok).length;
  console.log(`\n完成：${okCount}/${report.steps.length} 步通过`);
  console.log(`报告：${reportPath}`);
  if (docs) console.log(`文档列表摘要：${JSON.stringify(summarize(docs)).slice(0, 300)}`);
  if (docInfo) console.log(`当前文档：${JSON.stringify(summarize(docInfo)).slice(0, 300)}`);
  void toolsList;
}

main().catch((error) => {
  console.error(`探针失败：${error?.message || error}`);
  process.exit(1);
});
