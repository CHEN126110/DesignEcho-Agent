#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const AGENT_ROOT = path.resolve(__dirname, '..');
const WORKSPACE_ROOT = path.resolve(AGENT_ROOT, '..');
const UXP_ROOT = path.join(WORKSPACE_ROOT, 'DesignEcho-UXP');

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function main() {
  const webview = read(path.join(AGENT_ROOT, 'public/webview/index.html'));
  const pkg = JSON.parse(read(path.join(AGENT_ROOT, 'package.json')));
  const uxpIndex = read(path.join(UXP_ROOT, 'src/index.ts'));

  assert(
    pkg.scripts?.['smoke:ui:sock-layout-panel-entry'] === 'node scripts/smoke-ui-sock-layout-panel-entry.cjs',
    'package should expose smoke:ui:sock-layout-panel-entry'
  );
  assert(webview.includes('id="btnSockLayout"'), 'UXP panel quick actions should expose btnSockLayout');
  assert(webview.includes('<span class="action-label">袜子排版</span>'), 'quick action label should be visible as 袜子排版');
  assert(webview.includes('id="pageSockLayout"'), 'sock layout should have a dedicated configuration page');
  assert(webview.includes('id="sockLayoutProjectRoot"'), 'sock layout page should collect project root in one place');
  // 项目路径走原生目录选择器（免手敲路径），保留输入框供粘贴/展示
  assert(webview.includes('id="btnSockLayoutPickRoot"'), 'project root should offer a native folder picker button');
  assert(webview.includes("sendToUXP('sockLayoutPickProjectRoot'"), 'picker button should request folder selection from UXP');
  assert(webview.includes("case 'sockLayoutPickProjectRootResult':"), 'WebView should apply the picked folder path');
  assert(webview.includes('id="sockColorCombos"'), 'sock layout page should collect color combinations as the primary input');
  assert(webview.includes('id="sockTemplateOverride"'), 'sock layout page should expose an optional template override');
  assert(!webview.includes('id="sockLayoutCsv"'), 'legacy layout CSV textarea should be removed from the sock layout page');
  assert(!webview.includes('id="sockColorCsv"'), 'legacy color CSV textarea should be removed from the sock layout page');
  // 命名模板输入已删除：执行层不消费 outputPattern，暴露该输入会造成"预览一个名、导出另一个名"
  assert(!webview.includes('id="sockOutputPattern"'), 'output naming pattern input should be removed (execution layer never consumed it)');
  assert(webview.includes("outputPattern: '%模板%/%素材%'"), 'panel should pin outputPattern to the execution-layer naming (模板名/颜色组合.jpg)');
  assert(webview.includes('id="sockLayoutQuality"'), 'sock layout page should expose JPEG quality');
  assert(webview.includes('id="sockLayoutResult"'), 'sock layout page should render parse result and blockers');
  assert(webview.includes('comboText:'), 'sock layout payload should send comboText to UXP');
  assert(!webview.includes('layoutCsvText: String(document.getElementById'), 'sock layout payload should no longer collect layout/color CSV text');
  assert(webview.includes("sendToUXP('sockLayoutPreview'"), 'sock layout page should send preview requests to UXP');
  assert(webview.includes("case 'sockLayoutPreviewResult':"), 'WebView should render sock layout preview results from UXP');

  // 自动解析：输入防抖触发，不再依赖手动点解析
  assert(webview.includes('function scheduleSockLayoutAutoParse'), 'sock layout inputs should auto-trigger parsing with debounce');
  assert(webview.includes("el.addEventListener('input', scheduleSockLayoutAutoParse)"), 'sock layout fields should be wired to auto parse on input');
  // 防竞态：解析请求带序号，过期响应丢弃
  assert(webview.includes('sockLayoutRequestSeq'), 'sock layout parsing should carry a request sequence to drop stale responses');
  // 配置持久化：localStorage 记住上次配置并在进入页面时恢复
  assert(webview.includes('designecho_sock_layout_config_v1'), 'sock layout config should persist to localStorage');
  assert(webview.includes('function restoreSockLayoutConfigFromLocal'), 'sock layout page should restore the last config on open');
  // 一键执行：解析通过后同一按钮变为开始排版，二次点击确认后发 sockLayoutExecute
  assert(webview.includes("sendToUXP('sockLayoutExecute'"), 'sock layout page should send execute requests to UXP');
  assert(webview.includes('再点一次确认执行'), 'execute should require a two-step confirmation before writing Photoshop');
  assert(webview.includes("case 'sockLayoutExecuteProgress':"), 'WebView should render per-combo execute progress');
  assert(webview.includes("case 'sockLayoutExecuteResult':"), 'WebView should render execute results');

  // ===== 方案B重组改约（2026-07-10）：信息架构重排 + 双通道 requestId + 打磨项 =====
  // ① 检查结果（原配置预览）上移为主输入的直接延伸：颜色组合 → 检查结果 → 可选设置
  //    根治"输入与反馈隔两张卡、360px 下不在同一视口"的结构病
  const combosIdx = webview.indexOf('id="sockColorCombos"');
  const resultIdx = webview.indexOf('id="sockLayoutResult"');
  const overrideIdx = webview.indexOf('id="sockTemplateOverride"');
  assert(combosIdx > 0 && resultIdx > combosIdx, 'parse feedback card should sit right below the primary combos input');
  assert(overrideIdx > resultIdx, 'optional template override should be demoted below the feedback card (merged into 可选设置)');
  // ② 项目路径折叠为摘要条（已填态）+ 最近项目列表（独立持久化键，不动"每会话恢复一次"语义）
  assert(webview.includes('id="sockLayoutRootSummary"'), 'project root should collapse to a summary bar when filled');
  assert(webview.includes('designecho_sock_layout_recent_roots_v1'), 'recent project roots should persist to their own localStorage key');
  // ③ 底栏唯一状态条：五态色点 + executing 进度条（进度数据来自既有事件，纯渲染）
  assert(webview.includes('id="sockLayoutStateDot"'), 'footer should encode the five states with a status dot');
  assert(webview.includes('id="sockLayoutProgressFill"'), 'executing state should render a progress bar from existing progress events');
  // ④ parse/execute 双 requestId 通道：执行结果不再被自动解析顶掉；
  //    执行开始时同步作废 parse 通道（防迟到解析回包把旧计划渲染成可执行）
  assert(webview.includes('sockLayoutExecuteRequestId'), 'execute should own an independent requestId channel');
  assert(webview.includes('function isStaleSockLayoutExecuteMessage'), 'execute progress/result staleness should check the execute channel');
  // ⑤ 知情确认：缺模板风险在二次确认时显性播报（常规分支保留「再点一次确认执行」既定文案，见上方断言）
  assert(webview.includes('再点一次仍然执行'), 'informed confirmation should surface missing-template risk in the confirm copy');
  // ⑥ blocked 态按钮指路（问题计数）；点击仍触发重新检查——手动重试兜底入口不可删
  assert(webview.includes('个问题待处理'), 'blocked state button should surface the problem count');
  // ⑦ 结果态交付把手：复制输出路径（"打开输出目录"需 UXP shell + manifest launchProcess 权限，另立任务评估）
  assert(webview.includes('id="btnSockLayoutCopyOutputDir"'), 'execute result should offer a copy-output-path handle');
  // ⑧ 迟到执行结果只做信息级渲染、不迁移状态机（看门狗解锁后强拉回 ready 会绕穿安全不变量）
  assert(webview.includes('sockLayoutAwaitingLateResult'), 'late execute results should render info-level without state migration');

  assert(uxpIndex.includes("case 'sockLayoutPreview':"), 'UXP action switch should handle sockLayoutPreview');
  assert(uxpIndex.includes('async function handleSockLayoutPreview'), 'UXP should implement a dedicated sock layout preview handler');
  assert(uxpIndex.includes("handleToolCall('sockLayoutConfig'"), 'sock layout preview should use the sockLayoutConfig tool');
  assert(uxpIndex.includes("sendToWebView('sockLayoutPreviewResult'"), 'UXP should send sockLayoutPreviewResult back to WebView');

  // 目录选择器 UXP 侧：原生 getFolder 弹窗，取消回空 path
  assert(uxpIndex.includes("case 'sockLayoutPickProjectRoot':"), 'UXP action switch should handle sockLayoutPickProjectRoot');
  assert(uxpIndex.includes("sendToWebView('sockLayoutPickProjectRootResult'"), 'UXP should send picked folder path back to WebView');

  // 一键执行 UXP 侧：走 skuLayout 写链路，纪律与 sku-batch 执行器一致
  assert(uxpIndex.includes("case 'sockLayoutExecute':"), 'UXP action switch should handle sockLayoutExecute');
  assert(uxpIndex.includes('async function handleSockLayoutExecute'), 'UXP should implement a dedicated sock layout execute handler');
  assert(uxpIndex.includes("handleToolCall('skuLayout'"), 'sock layout execute should go through the skuLayout write tool');
  assert(uxpIndex.includes('combos: [combo]'), 'execute should keep the one-combo-per-call discipline (template reopen is a guardrail)');
  assert(uxpIndex.includes('host is in a modal state'), 'execute should retry once after Photoshop modal state');
  assert(uxpIndex.includes("sendToWebView('sockLayoutExecuteProgress'"), 'UXP should push per-combo execute progress');
  assert(uxpIndex.includes("sendToWebView('sockLayoutExecuteResult'"), 'UXP should send execute results back to WebView');

  console.log(JSON.stringify({
    success: true,
    checks: [
      'UXP WebView exposes a visible 袜子排版 quick action',
      'sock layout page is combos-first: one color-combination input plus optional template override',
      'legacy layout/color CSV inputs and the misleading output-pattern input are removed',
      'inputs auto-parse with debounce, carry request sequence, persist to localStorage',
      'WebView sends comboText via sockLayoutPreview to UXP',
      'UXP handles sockLayoutPreview through sockLayoutConfig',
      'one-click execute goes through skuLayout with one-combo-per-call discipline and modal-state retry',
      'WebView renders preview summaries, execute progress and per-group results',
      '方案B: feedback card sits right below combos input; template override demoted into 可选设置',
      '方案B: project root collapses to summary bar with recent-roots list',
      '方案B: footer is the single status bar (state dot + executing progress bar)',
      '方案B: parse/execute dual requestId channels; late execute results render info-level only',
      '方案B: informed confirmation surfaces missing-template risk; blocked button shows problem count',
      '方案B: execute result offers copy-output-path handle'
    ]
  }, null, 2));
}

main();
