#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * smoke: audit-photoshop-mcp 离线静态模式
 *
 * 守护的不变量（对应 2026-07-02 修复）：
 * 1. Photoshop MCP 端点不可达（本机没跑 Photoshop）时，审计脚本不再在 getHostSummary 的
 *    fetch 上直接崩掉，而是降级为 static-offline 模式：唯一的判定断言
 *    （UXP registry vs Agent 四来源声明的反向 diff）照常执行并保持 exit 语义。
 * 2. 离线模式下运行时相关核对显式标记 skipped-offline，不产出假的 "None/no" 结论。
 * 3. 反向 diff 应用 TOOL_NAME_ALIASES：Agent 以 camelCase 声明、经别名派发的 UXP 工具
 *    （harmonize_layer / quick_harmonize）不得再被判为缺口（历史假阳性回归钉）。
 * 4. --runtime-smoke 显式要求真机执行，端点不可达时必须失败，不允许静默降级。
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const net = require('net');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const AUDIT_SCRIPT = path.join(ROOT, 'scripts', 'audit-photoshop-mcp.cjs');
const JSON_OUT = path.join(ROOT, 'tmp', 'photoshop-mcp-inventory.json');
const MD_OUT = path.join(ROOT, 'tmp', 'photoshop-mcp-inventory.md');

let checkCount = 0;

function assert(condition, message) {
  checkCount += 1;
  if (!condition) {
    throw new Error(`[check ${checkCount}] ${message}`);
  }
  console.log(`ok ${checkCount} - ${message}`);
}

/** 拿一个刚释放的本地端口：先 bind 0 取端口再关闭，确保 fetch 得到 ECONNREFUSED */
function findClosedPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

function runAudit(endpoint, extraArgs = []) {
  const result = spawnSync(process.execPath, [AUDIT_SCRIPT, ...extraArgs], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, MCP_ENDPOINT: endpoint },
    timeout: 120000
  });
  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    combined: `${result.stdout || ''}\n${result.stderr || ''}`
  };
}

async function main() {
  assert(fs.existsSync(AUDIT_SCRIPT), `审计脚本存在: ${AUDIT_SCRIPT}`);

  const closedPort = await findClosedPort();
  const endpoint = `http://127.0.0.1:${closedPort}/mcp`;

  // --- 场景 1：端点不可达 + 默认模式 → 静态判定照常执行，exit 0 ---
  const offlineRun = runAudit(endpoint);
  assert(
    offlineRun.status === 0,
    `离线默认模式 exit 0（实际 ${offlineRun.status}）。stderr 摘要: ${offlineRun.stderr.slice(0, 400)}`
  );
  assert(
    offlineRun.combined.includes('OFFLINE 静态模式'),
    '输出包含离线降级警示（OFFLINE 静态模式）'
  );
  assert(
    offlineRun.combined.includes('需真机'),
    '输出明确提示运行时核对需真机复跑'
  );
  assert(
    /UXP tools missing from Agent \(gap this audit closes\): \d+/.test(offlineRun.combined),
    '静态反向 diff（唯一判定断言）在离线模式下真实执行并输出计数'
  );

  const report = JSON.parse(fs.readFileSync(JSON_OUT, 'utf8'));
  assert(report.online === false, 'JSON 报告 online === false');
  assert(report.mode === 'static-offline', `JSON 报告 mode === static-offline（实际 ${report.mode}）`);
  assert(
    typeof report.offlineReason === 'string' && report.offlineReason.includes(endpoint),
    'offlineReason 指明具体不可达端点'
  );
  assert(
    Array.isArray(report.inventory.entries) && report.inventory.entries.length > 0,
    `静态清单解析出 UXP registry 工具条目（${report.inventory.entries.length} 条）`
  );
  assert(
    report.inventory.runtimeVerification === 'skipped-offline',
    'inventory 运行时核对标记 skipped-offline'
  );
  assert(
    report.agentToolCoverage.runtimeVerification === 'skipped-offline',
    'agentToolCoverage 运行时核对标记 skipped-offline'
  );
  assert(
    report.inventory.missingInRuntime.length === 0
      && report.agentToolCoverage.missingRuntimeTools.length === 0,
    '离线模式不产出 missing_in_runtime / missingRuntimeTools 假阳性'
  );
  assert(
    report.inventory.entries.every((item) => item.runtimeExposed === null),
    '离线模式 runtimeExposed 全为 null（未验证），不是假 false'
  );
  assert(
    Array.isArray(report.uxpToolsMissingFromAgent.missing),
    '反向 diff 结果结构存在'
  );

  // 回归钉：经 TOOL_NAME_ALIASES 派发的工具不得被反向 diff 误判为缺口
  for (const aliasedRuntimeName of ['harmonize_layer', 'quick_harmonize']) {
    assert(
      !report.uxpToolsMissingFromAgent.missing.includes(aliasedRuntimeName),
      `别名工具 ${aliasedRuntimeName} 不在缺口清单（反向 diff 已应用 TOOL_NAME_ALIASES）`
    );
  }

  const markdown = fs.readFileSync(MD_OUT, 'utf8');
  assert(
    markdown.includes('Skipped — endpoint unreachable'),
    'Markdown 报告运行时章节标记 Skipped 而非假 None'
  );
  assert(
    markdown.includes('- Mode: static-offline'),
    'Markdown 报告标注 static-offline 模式'
  );

  // --- 场景 2：端点不可达 + --runtime-smoke → 必须失败，不允许静默降级 ---
  const runtimeSmokeRun = runAudit(endpoint, ['--runtime-smoke']);
  assert(
    runtimeSmokeRun.status !== 0,
    `离线 --runtime-smoke 必须失败（实际 exit ${runtimeSmokeRun.status}）`
  );
  assert(
    runtimeSmokeRun.combined.includes('--runtime-smoke 需要可用的 Photoshop MCP 端点'),
    '--runtime-smoke 失败信息指明原因与端点要求'
  );

  console.log(`\nsmoke-audit-photoshop-mcp-offline: ${checkCount} checks passed`);
}

main().catch((error) => {
  console.error(`smoke-audit-photoshop-mcp-offline FAILED: ${error?.stack || error?.message || String(error)}`);
  process.exit(1);
});
