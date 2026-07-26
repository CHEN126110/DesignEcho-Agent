#!/usr/bin/env node
'use strict';

/**
 * 历史兼容入口。
 *
 * 原脚本依赖已删除的 v5 prototype repository 路径。保留文件名供旧命令调用，
 * 但统一转发到当前主进程 FileArtifactRepository 的权威 smoke。
 */

const path = require('path');
const { spawnSync } = require('child_process');

console.warn(
  '[compat] smoke-agent-runtime-v5-contracts.cjs 已迁移到 smoke-artifact-repository.cjs。'
);

const result = spawnSync(
  process.execPath,
  [path.join(__dirname, 'smoke-artifact-repository.cjs')],
  {
    cwd: path.resolve(__dirname, '..'),
    stdio: 'inherit'
  }
);

if (result.error) {
  throw result.error;
}

if (result.signal) {
  console.error(`兼容 smoke 被信号 ${result.signal} 中止。`);
  process.exitCode = 1;
} else {
  process.exitCode = result.status === null ? 1 : result.status;
}
