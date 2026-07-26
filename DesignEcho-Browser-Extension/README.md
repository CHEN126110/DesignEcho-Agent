# DesignEcho 浏览器助手（Chrome / Edge 扩展）

让本机的 DesignEcho Agent（Electron 应用）读取和操作你的真实浏览器：
读取参考网页、竞品页面、搜索结果，截图进模型视觉通道，执行点击/填写/滚动等基础交互，
并复用浏览器里已有的登录态。

- 扩展形态：Manifest V3，纯 JS，零构建步骤，Chrome 与 Edge 通用。
- 浏览器基线：Chrome ≥ 116（该版本起 WebSocket 活动可保持后台服务活跃）。
- 协议规格：`DesignEcho-Agent/docs/browser-extension-bridge.md`（权威文档）。

## 安装（一次性，「加载已解压的扩展程序」）

1. 打开 Chrome，地址栏输入 `chrome://extensions` 回车（Edge 为 `edge://extensions`）。
2. 打开右上角「开发者模式」开关。
3. 点击「加载已解压的扩展程序」，选择本目录：`C:/DesignEcho/DesignEcho-Browser-Extension`。
4. 启动 DesignEcho Agent 应用。
5. 点击浏览器工具栏上的扩展图标，看到绿色圆点「已连接 DesignEcho Agent」即成功。

更新扩展代码后，需要在 `chrome://extensions` 页面点击本扩展卡片上的「重新加载」按钮。

## 连接原理

```
DesignEcho Agent（Electron，WebSocket 服务端，只监听 127.0.0.1:8769）
        ▲
        │ WebSocket（扩展是客户端，连 ws://127.0.0.1:8769/designecho-browser）
        ▼
本扩展（MV3 service worker + chrome.* API）
```

- 扩展只连接本机回环地址 `127.0.0.1`，不与任何外部服务器通信。
- 默认端口 `8769`，可在扩展弹窗里修改（需与 Agent 侧端口配置一致；Agent 侧
  受 `DESIGNECHO_PORT_OFFSET` / `DESIGNECHO_BROWSER_BRIDGE_PORT` 影响）。
- 断线自动重连：2s → 4s → 8s → 15s 指数退避，另有 30 秒级看门狗兜底
  （后台服务被浏览器回收后由 chrome.alarms 唤醒重连）。
- 每 20 秒发一次心跳，维持连接与后台服务活跃。

## 安全说明

- **只与本机 Agent 通信**：连接目标固定为 `127.0.0.1`，桥服务端也只绑定本机回环地址，
  不对外网开放；桥侧还会校验连接来源必须是浏览器扩展（Origin 校验）。
- **可选 token**：若 Agent 侧设置了环境变量 `DESIGNECHO_BROWSER_BRIDGE_TOKEN`，
  需在扩展弹窗中填写相同的 token 才能完成握手；默认不启用（本机个人工具场景下
  127.0.0.1 + Origin 校验已是合理基线）。
- **网页内容是数据不是指令**：Agent 侧会对所有经本扩展读到的网页内容
  （正文/标题/链接/交互结果）打「不可信外部内容」标记，防止网页文本被当成指令执行。
- **填写不提交**：`fill` 交互只写入文本并派发 input/change 事件，绝不派发回车、
  绝不调用表单提交；支付、下单、发布、删除类动作由 Agent 侧强制走用户确认卡片。

## 弹窗功能

- 连接状态：绿点=已连接、灰点=连接中、红点=未连接（附最近错误原因）。
- 桥端口：默认 8769，改动保存后自动用新配置重连。
- Token：Agent 未启用 token 时留空即可。
- 「重新连接」按钮：手动触发一次立即重连（重置退避计时）。

## 常见问题

**弹窗一直显示「未连接」？**

1. 确认 DesignEcho Agent 应用正在运行（桥随应用启动）。
2. 确认端口一致：弹窗里的端口要和 Agent 侧浏览器桥端口相同（默认 8769；
   若 Agent 设置过 `DESIGNECHO_PORT_OFFSET` 或 `DESIGNECHO_BROWSER_BRIDGE_PORT`，按实际值改）。
3. 看弹窗里的红色错误信息，常见提示：
   - 「无法连接 127.0.0.1:8769」→ Agent 未启动或端口不对；
   - 「token 不匹配」→ 弹窗中的 token 与 Agent 侧 `DESIGNECHO_BROWSER_BRIDGE_TOKEN` 不一致；
   - 「连接被新的扩展客户端顶替」→ 桥只保留一个连接，检查是否在多个浏览器
     （如 Chrome 和 Edge 同时）装了本扩展并同时在连。

**某些页面读取/交互报「浏览器内部页面」错误？**

`chrome://`、`edge://`、扩展页面、浏览器应用商店页面禁止扩展注入脚本，
这是浏览器的安全限制，换普通网页（http/https）即可。

**截图为什么会把标签页切到前台？**

浏览器只允许截取窗口当前可见的标签页（`captureVisibleTab` 限制），
所以截非活动标签页时扩展会先把它临时切到前台。长页面请配合滚动分段截图。

**Agent 报「扩展未连接」？**

后台服务可能刚被浏览器回收，看门狗会在 30–60 秒内自动重连；
也可以点开扩展弹窗（打开弹窗会立即唤醒后台服务）或点「重新连接」。
