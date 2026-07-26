#!/usr/bin/env node
/**
 * 修复 onnxruntime-node 在 Windows 上因系统 VC++ 运行库版本错配/损坏导致的
 * "A dynamic link library (DLL) initialization routine failed" 加载失败。
 *
 * 背景（真实根因）：
 *   onnxruntime.dll（>=1.20 用 VS2022 编译）需要匹配的新版 CRT（msvcp140/vcruntime140 >= 14.3x）。
 *   若系统 System32 里的 msvcp140.dll / vcruntime140.dll 停留在旧版本（例如 14.00），
 *   加载时 CRT 初始化例程失败 -> Windows 错误 1114 -> 抠图推理引擎无法初始化。
 *
 * 本脚本做的事（app-local 部署，Windows 官方支持的方式）：
 *   把一套版本一致的 VC++ CRT 运行库复制到 onnxruntime.dll 所在目录。
 *   Node/Electron 以 LOAD_WITH_ALTERED_SEARCH_PATH 加载 .node，会优先搜同目录，
 *   从而绕过 System32 里损坏/过旧的 CRT。
 *
 * 设计约束：
 *   - 仅 win32 + x64 生效，其它平台直接跳过。
 *   - 幂等：目标目录已有 msvcp140.dll 则不重复复制。
 *   - 失败安全：任何异常只打印指引，退出码始终为 0，绝不使 npm install 失败。
 *   - 零依赖：只用 Node 内置模块。
 *
 * 注意：这只是让本应用在“系统 CRT 损坏”的机器上仍能工作的兜底。
 *       真正的根治是修复系统运行库：安装/修复 Microsoft Visual C++ 2015-2022 (x64) Redistributable。
 *
 * 手动运行：node scripts/fix-onnxruntime-vcruntime.cjs
 */

'use strict';

const fs = require('fs');
const path = require('path');

// 需要与 onnxruntime.dll 同目录部署的 CRT 文件（存在则复制）
const CRT_FILES = [
  'vcruntime140.dll',
  'vcruntime140_1.dll',
  'vcruntime140_threads.dll',
  'msvcp140.dll',
  'msvcp140_1.dll',
  'msvcp140_2.dll',
  'msvcp140_atomic_wait.dll',
  'msvcp140_codecvt_ids.dll',
  'concrt140.dll',
];

// 触发复制的关键文件：缺它就说明 CRT 未部署
const SENTINEL = 'msvcp140.dll';

function log(msg) {
  console.log(`[fix-onnxruntime-vcruntime] ${msg}`);
}

/** 定位 onnxruntime.dll 所在目录（bin/napi-vX/win32/x64） */
function findOnnxRuntimeBinDir() {
  const base = path.join(__dirname, '..', 'node_modules', 'onnxruntime-node', 'bin');
  if (!fs.existsSync(base)) return null;
  const stack = [base];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        stack.push(full);
      } else if (e.isFile() && e.name.toLowerCase() === 'onnxruntime.dll') {
        return dir;
      }
    }
  }
  return null;
}

/** 把形如 14.44.35112 的版本串解析成可比较数组 */
function parseVer(str) {
  const m = String(str).match(/(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function cmpVer(a, b) {
  for (let i = 0; i < 3; i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) - (b[i] || 0);
  }
  return 0;
}

/**
 * 搜索机器上可用的 VC++ CRT 源目录（VS Redist 里的 Microsoft.VC14x.CRT/x64）。
 * 版本号从路径中的 MSVC\<ver> 提取，选 >= 14.30 中最新的一个。
 */
function findBestCrtSource() {
  const vsRoots = [
    'C:\\Program Files\\Microsoft Visual Studio\\2022',
    'C:\\Program Files (x86)\\Microsoft Visual Studio\\2022',
    'C:\\Program Files\\Microsoft Visual Studio\\2019',
    'C:\\Program Files (x86)\\Microsoft Visual Studio\\2019',
  ];
  const MIN_VER = [14, 30, 0];
  const candidates = []; // { dir, ver }

  for (const root of vsRoots) {
    if (!fs.existsSync(root)) continue;
    let editions;
    try {
      editions = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory());
    } catch {
      continue;
    }
    for (const ed of editions) {
      const msvcDir = path.join(root, ed.name, 'VC', 'Redist', 'MSVC');
      if (!fs.existsSync(msvcDir)) continue;
      let vers;
      try {
        vers = fs.readdirSync(msvcDir, { withFileTypes: true }).filter((e) => e.isDirectory());
      } catch {
        continue;
      }
      for (const v of vers) {
        const ver = parseVer(v.name);
        if (!ver || cmpVer(ver, MIN_VER) < 0) continue;
        // Microsoft.VC143.CRT / VC142 / VC141 皆可，取存在且含 sentinel 的
        const crtParent = path.join(msvcDir, v.name, 'x64');
        if (!fs.existsSync(crtParent)) continue;
        let crtDirs;
        try {
          crtDirs = fs.readdirSync(crtParent, { withFileTypes: true }).filter((e) => e.isDirectory());
        } catch {
          continue;
        }
        for (const c of crtDirs) {
          if (!/^Microsoft\.VC\d+\.CRT$/i.test(c.name)) continue;
          const crtDir = path.join(crtParent, c.name);
          if (fs.existsSync(path.join(crtDir, SENTINEL))) {
            candidates.push({ dir: crtDir, ver });
          }
        }
      }
    }
  }

  if (!candidates.length) return null;
  candidates.sort((a, b) => cmpVer(b.ver, a.ver)); // 版本降序
  return candidates[0];
}

function main() {
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    log(`跳过（当前平台 ${process.platform}/${process.arch}，仅 win32/x64 需要此修复）`);
    return;
  }

  const binDir = findOnnxRuntimeBinDir();
  if (!binDir) {
    log('未找到 onnxruntime-node 的 onnxruntime.dll（依赖可能尚未安装），跳过。');
    return;
  }

  const sentinelPath = path.join(binDir, SENTINEL);
  if (fs.existsSync(sentinelPath)) {
    log(`CRT 已就位（${SENTINEL} 存在于 ${binDir}），无需处理。`);
    return;
  }

  const src = findBestCrtSource();
  if (!src) {
    log('未在机器上找到可用的 VC++ CRT（Microsoft.VC14x.CRT）源目录。');
    log('抠图推理引擎可能因系统 VC++ 运行库过旧/损坏而无法加载。');
    log('请安装/修复 Microsoft Visual C++ 2015-2022 (x64) Redistributable 后重启应用：');
    log('  https://aka.ms/vs/17/release/vc_redist.x64.exe');
    return;
  }

  log(`发现 CRT 源：${src.dir}（版本 ${src.ver.join('.')}）`);
  let copied = 0;
  for (const name of CRT_FILES) {
    const from = path.join(src.dir, name);
    if (!fs.existsSync(from)) continue; // 该 CRT 集合里没有此文件则跳过
    try {
      fs.copyFileSync(from, path.join(binDir, name));
      copied++;
    } catch (e) {
      log(`复制 ${name} 失败：${e && e.message ? e.message : e}`);
    }
  }
  log(`已复制 ${copied} 个 CRT 文件到 ${binDir}`);
  log('抠图推理引擎的 onnxruntime 依赖修复完成。');
}

try {
  main();
} catch (e) {
  // 失败安全：绝不因本脚本导致 npm install 失败
  log(`执行异常（已忽略，不影响安装）：${e && e.message ? e.message : e}`);
}

process.exit(0);
