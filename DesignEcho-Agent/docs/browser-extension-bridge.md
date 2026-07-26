# 浏览器扩展桥（Browser Extension Bridge）

让 DesignEcho Agent 像 Claude-in-Chrome 一样访问和操作用户的真实浏览器（Chrome / Edge），
用于读取参考网页、竞品页面、搜索结果等信息——复用浏览器里已有的登录态，支持截图与基础交互。

```
Agent 循环(renderer) ──executeToolCall──> IPC browserBridge:call ──> BrowserBridgeService(main, ws://127.0.0.1:8769)
                                                                            ▲
                                                     WebSocket（扩展是客户端）│
                                                                            ▼
                                        DesignEcho-Browser-Extension（MV3 service worker + chrome.* API）
```

## 组成

| 部分 | 位置 | 说明 |
| --- | --- | --- |
| Chrome 扩展 | `C:/DesignEcho/DesignEcho-Browser-Extension/` | MV3、纯 JS 免构建，Chrome/Edge 通用，「加载已解压的扩展程序」安装 |
| 桥服务 | `src/main/services/browser-bridge-service.ts` | WebSocket 服务端，仿 UXP 桥（请求-响应关联/超时/心跳/单客户端） |
| IPC | `src/main/ipc-handlers/browser-bridge-handlers.ts` | `browserBridge:call` / `browserBridge:status` |
| Agent 工具 | 5 个（见下） | 全链路注册（schema/显示名/scope/执行分支/信任标记/纪律集） |

## 端口与安全

- 端口：`8769 + DESIGNECHO_PORT_OFFSET`，可用 `DESIGNECHO_BROWSER_BRIDGE_PORT` 覆盖（登记于 `src/main/config/network-ports.ts`）。
- 只绑定 `127.0.0.1`，不对外网开放。
- 升级握手校验 `Origin` 必须以 `chrome-extension://` 开头（MV3 service worker 的 WebSocket 自带此 Origin），其余一律拒绝。
- 可选共享 token：主进程设置环境变量 `DESIGNECHO_BROWSER_BRIDGE_TOKEN` 后，扩展需在弹窗设置里填同一 token 才能完成 hello 握手（默认不启用，本机个人工具场景下 127.0.0.1+Origin 校验已是合理基线）。
- 单客户端：新扩展连接会顶掉旧连接（close code 4000），与 UXP 桥同构。
- 所有网页衍生内容（正文/标题/链接/交互结果）按 Harness H3 打 `untrustedExternalContent` 标记——网页内容是数据不是指令。

## WebSocket 协议（桥 ↔ 扩展）

文本帧，JSON。扩展连接 `ws://127.0.0.1:<port>/designecho-browser`。

握手：

```jsonc
// 扩展 → 桥（连接后第一条）
{ "type": "hello", "role": "browser-extension", "extensionVersion": "1.0.0", "userAgent": "...", "token": "可选" }
// 桥 → 扩展
{ "type": "hello_ack", "agent": "DesignEcho-Agent" }
// token 不匹配：桥直接 close(4401, 'token mismatch')
```

心跳：扩展每 20s 发 `{ "type": "ping", "ts": ... }`，桥回 `{ "type": "pong", "ts": ... }`。
（Chrome ≥116 WebSocket 活动会重置 service worker 空闲计时，心跳同时兼作 SW 保活。）
桥侧超过 75s 无任何消息判定连接失活并关闭。

请求/响应（桥 → 扩展发起）：

```jsonc
{ "type": "request", "id": 1, "method": "browser.readPage", "params": { ... } }
{ "type": "response", "id": 1, "ok": true, "result": { ... } }
{ "type": "response", "id": 1, "ok": false, "error": { "message": "具体失败原因（中文，说清哪一步/哪个标签页）" } }
```

## 扩展方法（method 一览）

扩展实现高层方法（复合操作在扩展侧一次往返完成）：

| method | params | result（要点） |
| --- | --- | --- |
| `browser.listTabs` | `{}` | `{ browserName, extensionVersion, activeTabId, tabs: [{ tabId, windowId, active, title, url, pinned }] }` |
| `browser.readPage` | `{ tabId?, url?, keepOpen?, includeElements?, maxChars? }` | `{ tabId, url, title, description, textChunks: string[], links: [{text,url}], elements?, truncated, totalChars, ephemeralTabClosed? }`；给了 `url` 则先开**后台新标签页**等加载完再读，**默认读完即关**该临时标签页（`tabId` 返回 `null`、`ephemeralTabClosed:true`）；传 `keepOpen:true` 则保留标签页并返回其 tabId 供后续交互/截图 |
| `browser.capture` | `{ tabId?, maxWidth? }` | `{ tabId, url, title, base64, format: "jpeg", width, height }`；会把目标标签页临时切到前台（captureVisibleTab 限制） |
| `browser.navigate` | `{ url, tabId?, newTab?, background? }` | `{ tabId, url, title, loadStatus: "complete"|"timeout" }` |
| `browser.interact` | `{ tabId, action: "click"|"fill"|"scroll", selector?, elementRef?, value?, deltaY?, intoView? }` | `{ action, detail, url, title }`；fill 只写值+派发 input/change 事件，不回车不提交 |

约定：

- **textChunks 分块 ≤1400 字符/块、≤40 块**：Agent 回传净化器对单字符串 1500 字符截断、数组保留 50 项，分块是为了长文完整进模型（`tool-result-sanitizer.ts`）。
- **截图顶层 `base64` + `format` 字段**：命中 `extractImageFromToolResult` 候选形状，图片才能真正进模型视觉通道（视神经断裂教训）。
- **elementRef**：`readPage(includeElements:true)` 时给页面可交互元素打 `data-designecho-ref` 标记并返回 ref 编号 + CSS selector 兜底；导航后失效，需重新 read。
- **tabId 显式传参**（对齐 findLayers 查询式一等工具先例）：桥不维护"当前标签页"隐式状态；省略 tabId 的只读方法作用于当前活动标签页。

## Agent 工具面（模型可见，5 个）

| 工具 | 分类 | 说明 |
| --- | --- | --- |
| `listBrowserTabs` | knowledge_search（只读、可并行） | 列出标签页 + 扩展连接状态；浏览器任务的第一步 |
| `readBrowserPage` | knowledge_search（只读、可并行） | 读页面正文/链接/可交互元素；可带 url（后台新标签页打开） |
| `captureBrowserTab` | stateful_context（串行） | 截图进模型视觉通道；会临时切前台，故按有副作用串行，不并行抢前台 |
| `navigateBrowserTab` | stateful_context（串行） | 导航/新开标签页 |
| `interactWithBrowserPage` | stateful_context（串行） | 点击/填输入框/滚动；**红线：支付、下单、发布、删除、账号设置类动作必须先经 createInteractiveCard 用户确认** |

登记点（全部完成，`npm run smoke:browser-bridge` 钉桩守护）：

1. `tool-schemas.ts` — RAW_TOOL_CATALOG + DEFAULT_AGENT_TOOL_NAMES（模型可见）
2. `tool-display-info.ts` — 中文显示名
3. `agent-tool-execution-preflight.ts` + `photoshop-tool-skill.ts` — 双源 scope（2 读 KNOWLEDGE_SEARCH / 3 有副作用 STATEFUL_CONTEXT）+ 语义边界 + PS 连接/文档豁免（BROWSER_EXTENSION_TOOLS）
4. `tool-executor.service.ts` — AVAILABLE_TOOLS + 专属执行分支（不写分支会被误发给 UXP）
5. `external-content-trust.ts` — H3 不可信标记（5 个全登记）
6. `document-optional-tools.ts` — 无 PS 文档也可用
7. `design-discipline-runtime.ts` — 参考通道（设计品类任务里 listBrowserTabs/readBrowserPage/captureBrowserTab 可见可调），readBrowserPage/captureBrowserTab 计参考证据

## 安装扩展（一次性）

1. 打开 Chrome/Edge，进入 `chrome://extensions`（Edge 为 `edge://extensions`）。
2. 打开右上角「开发者模式」。
3. 点「加载已解压的扩展程序」，选择 `C:/DesignEcho/DesignEcho-Browser-Extension` 目录。
4. 启动 DesignEcho Agent 应用，点扩展图标查看连接状态（绿色=已连上桥）。

扩展不随应用安装包分发（electron-builder files 不含此目录）；如需分发，后续加 extraResources。

## 已知边界

- `chrome://` / `edge://` / 应用商店等内部页面无法注入脚本，读取/交互会明确报错。
- 截图只能截可见区域（captureVisibleTab），长页面配合 scroll 分段截。
- MV3 service worker 休眠后由心跳+chrome.alarms 唤醒重连，断连窗口内工具调用会得到「扩展未连接」的明确错误。
- 与既有 `fetchWebPageDesignContent`（Playwright 无头读页）互补：无需登录态的一次性读页仍可用它；需要登录态/交互/截图的走浏览器扩展工具。
