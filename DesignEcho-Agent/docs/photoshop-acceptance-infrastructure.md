# Photoshop 验收与 Debug 证据基础设施

## 当前目标

先搭建 Agent 基础设施，再扩展业务能力。这个切片只解决一件事：让 Agent 和开发者能拿到 Photoshop 当前文档的结构化验收证据，用于判断“任务是否真的改到了文档”。

## 已实现的最小能力

- UXP 工具：`getAcceptanceSnapshot`
- MCP 直连入口：`photoshop.acceptance_snapshot`
- Agent 工具提示：`getAcceptanceSnapshot`
- 离线 diff 工具：`diffAcceptanceSnapshots(before, after)`
- Smoke：`npm run smoke:acceptance:snapshot-diff`
- 写操作证据链：普通 Photoshop 写工具会采集 before / after 快照，并把 diff 放入工具结果的 `acceptance` 字段。
- 自适应采集策略：文本类保留文字/字体证据，图片类优先结构与 bounds，大批量类提高图层预算，显式 `acceptanceMode: "deep"` 时扩大采集范围。
- 用户可读摘要：`acceptance.summaryText` 会说明检测到的变化、无变化风险或快照失败原因。
- 任务级断言 MVP：`setTextStyle` 带 `fontName` 时会生成字体修改断言，`setTextContent` 带 `content` 或 `updates` 时会生成文本内容断言，`closeDocument` 会验证活动文档是否离开，`moveLayer` 会验证目标图层 left/top，`placeImage` 会验证新增图层与显式 x/y，`replaceImagePlaceholder` 会验证替换图层与 `placementAudit` bounds，`replaceLayerContent` 会验证新增替换图层、原图层隐藏和可选 bounds，`createTextLayer` 会验证新增文本图层、内容和可选字号，`createRectangle/createEllipse` 会验证新增形状图层和 bounds，`fillDetailPage` 会验证填充错误、数量和图片 placement 图层/bounds，区分通过、失败和需复核。
- 工具失败保护：`result.success === false` 时验收只能用于诊断，不会标记 `verified=true`，也不会把通过断言写成任务完成。
- 显式目标保护：显式 `layerId` / `updates.layerId` 缺失或不是文本图层时会标记任务断言失败，不降级成“需复核”。
- 普通反馈脱敏：模型上下文、工具结果块和调试报告优先展示摘要，不再默认输出完整工具 JSON。
- Debug Bridge 脱敏：HTTP 与 MCP 调试会话默认返回 session/message summary，不返回完整 metadata、trace、toolCalls、errors。
- Debug Bridge 完整读取门禁：只有设置 `DESIGNECHO_DEBUG_TOKEN` 且请求携带正确 token 时，HTTP / MCP tool 才允许读取完整 session。
- Smoke：`npm run smoke:tool-result:redaction` 检查普通反馈路径不会退回 raw JSON 直出。
- Smoke：`npm run smoke:debug-bridge:redaction` 检查 debug session 脱敏、token 门禁、MCP debug 读取、MCP resource 脱敏和 CORS 边界。
- Live Smoke：`npm run smoke:photoshop-acceptance:live` 在已连接 Photoshop UXP 插件时只读验证 `photoshop.acceptance_snapshot` 和 `getAcceptanceSnapshot` 两条入口是否可用。
- Live Write Smoke：`npm run smoke:photoshop-acceptance:write-live` 在已连接 Photoshop UXP 插件时创建一次性文档，验证中文文本创建、文本修改、图层移动、关闭不保存和切回原文档。
- Chat UI Smoke：`npm run smoke:chat-ui:execution-chain` 以代码级方式验证 ChatPanel 普通输入进入 unified Agent、工具完成结果进入 thinking steps、MessageRenderer/parser 展示验收摘要且不默认暴露 raw JSON/debugText。

## 快照内容

`getAcceptanceSnapshot` 读取：

- 当前文档：名称、尺寸、分辨率、颜色模式。
- 图层摘要：总图层、选中图层、隐藏图层、锁定图层、文本/组/智能对象/形状/像素图层数量。
- 图层结构：id、名称、类型、可见性、锁定、不透明度、混合模式、层级、父级、路径、选中状态。
- 几何信息：`bounds` 与 `boundsNoEffects`。
- 文本信息：文本内容、长度、字体名、字号、字距、行高等基础信息。

## 使用方式

通过通用 Photoshop MCP 工具调用：

```json
{
  "name": "getAcceptanceSnapshot",
  "arguments": {
    "includeHidden": true,
    "includeBounds": true,
    "includeText": true,
    "maxLayers": 300
  }
}
```

通过 MCP Host 直连入口调用：

```json
{
  "includeHidden": true,
  "includeBounds": true,
  "includeText": true,
  "maxLayers": 300
}
```

验收 smoke：

```bash
npm run smoke:photoshop-acceptance:live
npm run smoke:photoshop-acceptance:write-live
npm run smoke:chat-ui:execution-chain
npm run smoke:chat-ui:electron-bridge
```

`smoke:photoshop-acceptance:write-live` 会真实修改 Photoshop 状态，但只应创建并清理脚本自建的一次性文档；它不应修改用户当前工作文档。

`smoke:chat-ui:execution-chain` 不连接 Photoshop，也不点击运行中的 Electron 窗口；它只验证渲染代码链路、受控测试桥接门控和脱敏边界。

ChatPanel 测试桥接默认关闭。只有使用 `DESIGNECHO_CHAT_TEST_BRIDGE=1` 启动桌面端时，主进程才会给 renderer 注入 `designechoChatTestBridge=1` query，随后 renderer 才会暴露 `window.__DESIGNECHO_CHAT_TEST_BRIDGE__`。`smoke:chat-ui:electron-bridge` 会在启动前检查 8765 端口，端口已占用时安全跳过，避免干扰正在运行的 Agent 桌面端。

## 设计边界

- 不读取像素，不返回截图，避免把验收工具变成重型视觉工具。
- `getAcceptanceSnapshot` 和 `smoke:photoshop-acceptance:live` 不修改 Photoshop 文档；`smoke:photoshop-acceptance:write-live` 是显式写入验收，只允许操作脚本自建的一次性文档并关闭不保存。
- 不伪造完成状态；没有打开文档时返回 `hasDocument: false` 和明确 warning。
- 不替代人工视觉验收；它提供结构化证据，后续可叠加截图/像素相似度。
- 不把完整快照直接塞进用户回复；面向用户优先展示摘要、风险和关键 diff。
- 不用“性能优化”阉割结果质量；默认轻量采集，必要时通过 `acceptanceMode: "deep"` 做深度验收。
- 完整 `acceptance` 证据当前仍保留在内部工具结果对象中，普通 UI 和模型上下文只应消费摘要。
- Debug Bridge 默认不允许跨 Origin 读取；可通过 `DESIGNECHO_DEBUG_BRIDGE_ORIGINS` 显式配置允许的本地开发 Origin。
- HTTP / MCP 的 session 写入接口返回摘要而不是完整 trace；完整记录仍落盘，开发诊断工具需要通过 token 门禁读取完整 session。
- Chat UI smoke 只验证 ChatPanel / Agent 调用包装 / MessageRenderer/parser / 测试桥接门控的代码级边界，不证明真实模型、真实 Photoshop 工具和用户输入框在同一 Electron 会话中完整跑通。

## 体验与性能策略

- 默认模式只读取结构、bounds 和必要文本信息，不读取像素。
- 文本工具：采集文本内容和字体基础信息，用于发现“字体没改成功”。
- 图片工具：默认不扫描所有文本，重点验证新增/删除图层、bounds 和结构变化。
- 批量工具：提高 `maxLayers`，但仍不读取像素，避免详情页和 SKU 类任务被快照拖慢。
- 深度模式：允许显式扩大到更多图层和文本信息，用于 Debug 或验收疑难任务。
- 超时或快照失败不会伪造成成功，会在 `acceptance.status` 中标记 `snapshot_failed`。

## 下一步

- 扩展任务级验收断言：模板生成、图片内容一致性和截图级视觉比对。
- 已覆盖的任务级断言仍需真实 Photoshop 手测，特别是批量文本修改、目标图层缺失和隐式目标范围。
- `closeDocument` 当前只验证活动文档是否关闭或切换，不能证明非活动文档关闭，也不能证明磁盘保存状态。
- `moveLayer` 当前只验证目标图层几何位置是否符合参数，不判断这个位置是否审美合理，也不证明主体视觉落位质量。
- `placeImage` 当前只验证新增图层、可选命名和显式 x/y bounds，不验证图片内容、主体裁切、缩放审美或参考图相似度。
- `replaceImagePlaceholder` 当前只验证替换图层存在、旧目标是否仍残留、`placementAudit` / 快照 bounds 是否匹配，不验证图片内容、裁切质量或最终视觉设计质量。
- `replaceLayerContent` 当前只验证新增替换图层、原图层隐藏和可选 bounds，不验证变形像素质量、纹理自然度或修图结果。
- `createTextLayer` 当前只验证新增文本图层、文本内容和可选字号，不验证颜色、段落对齐、字体名映射和视觉排版质量。
- `createRectangle/createEllipse` 当前只验证新增形状图层和几何 bounds，不验证填充色、圆角、路径细节或最终渲染像素。
- `fillDetailPage` 当前只验证工具 errors、填充数量、图片 placement 的实际图层和 bounds，不验证详情页版式质量、图片内容、文案视觉排版、剪贴蒙版真实性或整体设计效果。
- 字体断言仍需真实 Photoshop 手测，特别是中文字体名与 PostScript fontName 的匹配关系。
- 后续再考虑像素级验收，不在本切片内实现。
- `smoke:photoshop-acceptance:live` 需要桌面端和 UXP 插件运行，不纳入默认 `maintenance:preflight`，避免离线开发被阻塞。
- `smoke:photoshop-acceptance:write-live` 同样需要桌面端和 UXP 插件运行，并且会创建临时文档；只作为显式人工/开发验收命令，不纳入默认 `maintenance:preflight`。
- 建立受控 ChatPanel UI 自动化或测试桥接入口，用真实输入提交请求并验证最终用户页面反馈。
