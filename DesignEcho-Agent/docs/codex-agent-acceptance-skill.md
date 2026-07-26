# Codex Agent Acceptance Skill

本文档定义 Codex 验收 DesignEcho Agent 的工作方法。它不是普通用户功能，也不是被测 Agent 的自证流程。

## 目标

1. 用真实证据减少用户、Codex 和 DesignEcho Agent 之间的信息差。
2. 把“感觉不对”“好像没执行”“很慢”转换成可复现的验收 case。
3. 明确问题层级：意图、上下文、路由、模型、工具、Photoshop、验收、性能或 UX。
4. 避免让被测 Agent 只凭最终回复证明自己完成任务。

## 分层

### 轻量 smoke

- 默认日常运行。
- 不连接真实 Photoshop。
- 校验验收契约、debug bundle、evaluator 和报告格式。
- 命令：`npm run smoke:agent:acceptance`。

### 中量 integration

- 关键链路改动后运行。
- 使用 Electron 测试桥或受控 Agent 运行时。
- 检查聊天 UI、生命周期 metadata、工具事件和 executionSummary。
- 在 `?designechoChatTestBridge=1` 下，可通过测试桥把最近一条 assistant 消息导出为 `AgentRunDebugBundle` 和 `AgentAcceptanceReport`。
- 命令：`npm run smoke:agent:acceptance:desktop`。
- 当前覆盖：
  - 保存 PSD 请求应走 `document-management`。
  - 关闭文档不保存请求应走 `document-management`。
  - 图层颜色从浅到深排序请求应走 `layer-management`，防止简单操作退回慢速 autonomous-agent。
  - C-1142 附图复刻请求应走 `layout-replication`，防止附图上下文丢失。
- 该层使用 fake model 和 fake Photoshop，只证明桌面 UI、路由和证据导出，不证明真实 Photoshop 写入或设计质量。

### 真实 provider integration

- 只在需要验证真实模型到 Agent 链路时显式运行。
- 使用真实配置的模型 provider，但仍使用 fake Photoshop，避免把 provider 问题和 Photoshop 写入问题混在一起。
- 默认不调用真实 provider，只输出 skipped 报告。
- 命令：`npm run smoke:agent:acceptance:real-provider`。
- 显式运行需要同时设置：
  - `DESIGNECHO_REAL_PROVIDER_AGENT_ACCEPTANCE=1`
  - `DESIGNECHO_REAL_PROVIDER_AGENT_ACCEPTANCE_ALLOW_API=1`

#### Capability 选择探针

- 命令：`npm run smoke:agent:acceptance:capability-provider`。
- 复用同一 real-provider runner、隔离 userData / 端口和 fake Photoshop，不创建第二套 provider 验收入口。
- provider 会看到生产 `design.generic.v1` 首轮 schema 集；Harness 只记录返回的 Tool 选择。任何 Tool call 都不会执行，只有 `requestAgentCapabilities` 的 ID 会送入真实 Capability Session 做纯内存激活。
- evaluator 判定 exact minimal、允许的等价能力、过度装载、错误能力、重复请求、激活失败和非控制 Tool 选择；报告不保存任意 Tool 参数、API key、本地路径或模型私有推理。
- 默认仍为 guarded skip；实际调用 provider 同样必须同时设置上面的两个 opt-in。guarded skip 只证明权限边界，不证明真实 provider 选择能力。
- 探针不进入完整 Agent 系统 Prompt 和多轮 ReAct，因此通过也只证明聚焦的 schema 选择能力，不证明开放式设计质量或生产稳定性。

### 重量 live acceptance

- 阶段验收或 Photoshop 工具改动后显式运行。
- 连接真实 Photoshop / UXP。
- 采集图层、bounds、文本、截图和 before/after snapshot。
- 不放入默认维护流程，避免拖慢日常开发。
- 默认不触碰 Photoshop，只输出 skipped 报告。
- 命令：`npm run smoke:agent:acceptance:live-photoshop`。
- 显式运行需要同时设置：
  - `DESIGNECHO_LIVE_AGENT_ACCEPTANCE=1`
  - `DESIGNECHO_LIVE_AGENT_ACCEPTANCE_TAKEOVER=1`
  - `DESIGNECHO_LIVE_AGENT_ACCEPTANCE_DISPOSABLE_DOCUMENT=1`

## 验收输入

每个 case 至少包含：

1. 用户原始需求。
2. 预期 route / skill / executionKind。
3. 是否应该使用工具。
4. 是否应该改变 Photoshop 文档。
5. 最大迭代或最大工具调用约束。

## 证据包

`AgentRunDebugBundle` 需要尽量包含：

1. 用户输入。
2. 模型和角色信息。
3. `agentRequestLifecycle`。
4. `executionSummary`。
5. 工具调用与成功/失败状态。
6. before/after `AcceptanceSnapshot`。
7. snapshot diff。
8. 用户可见 thinking / message 摘要。
9. errors / warnings。

## 判定规则

Codex 不直接相信最终回复，应按以下顺序判断：

1. 意图是否正确。
2. 路由是否正确。
3. skill 是否正确。
4. 是否应该进入 autonomous-agent。
5. 工具是否真的调用。
6. Photoshop 是否真的发生变化。
7. `executionSummary` 是否和证据一致。
8. 是否暴露伪思考、debug JSON 或生命周期内部字段。
9. 性能和迭代是否明显异常。

## 输出

验收结果输出为：

1. `tmp/acceptance/*.json`
2. `tmp/acceptance/*.md`
3. Electron 测试桥返回的临时 `AgentRunDebugBundle` / `AgentAcceptanceReport`

报告必须包含：

1. `passed` / `failed` / `needs_review`
2. 问题层级
3. blockers
4. warnings
5. 证据摘要
6. 下一步修复建议

## 当前边界

1. 轻量 smoke 只能验证工程正确性，不能证明审美质量。
2. snapshot diff 能证明结构或图层变化，不能证明设计高级。
3. live Photoshop acceptance 必须显式运行，不能偷偷加入默认维护命令。
4. FEX 等临时样本只能作为文字排版验证，不作为产品能力或工具边界。
5. 测试桥导出的真实消息证据仍需要 Codex 或测试脚本传入明确 `AcceptanceCase`，不能把任意聊天直接当成通过验收。
6. 桌面端 bridge smoke 默认使用 fake model 和 fake Photoshop，只证明 Electron/ChatPanel/证据导出链路，不证明真实模型质量或 Photoshop 文件效果。
7. 真实 provider integration 默认跳过，只有显式允许 API 调用才会消耗模型额度；它仍使用 fake Photoshop。
8. live Photoshop acceptance 默认跳过，只有显式 takeover 且使用一次性文档时才会触碰 Photoshop；它不证明开放式设计质量。
