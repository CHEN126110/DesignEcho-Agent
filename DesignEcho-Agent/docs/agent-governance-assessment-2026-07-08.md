# DesignEcho 专属治理报告（2026-07-08）

> 对象：已上线系统 DesignEcho（Electron 主程序 `DesignEcho-Agent` 渲染进程跑 Agent 循环 + Photoshop UXP 插件 `DesignEcho-UXP`，经 MCP host `127.0.0.1:8768` 暴露 PS 工具）。
> 定位：这是对既有系统的**治疗方案**，不是绿地重建。V0/V1/V2 是治疗阶段。
> 已确诊系统病（本报告在此之上深入，不重复发现）：
> - 病(a) 意图分类读"名词"不读"动词"：`design-task-types.ts` 的 `excludeSignals` 只有"导出当前"漏了裸"导出"，"导出主图详情页"被误判成"从零设计详情页"。
> - 病(b) 命令式硬牢笼焊进工具执行循环：`design-discipline-runtime.ts` 的 `evaluateDesignToolStateGuard` 9 个手写 if + 强制 `next-tool`，1 bit 误判被放大成全程走错、Agent 无权纠正。
> - 病(c) 已做补救（观察类/导出类永远放行 + 可推翻 agency 提示）方向对，但仍是"在耦合系统上打补丁"，未真正解耦。

---

## 1. 一页复核结论

### 这套框架可信、可直接当 DesignEcho 标尺的部分

框架复核里的 `soundConcepts` 整体可信，且与 Anthropic 一手文档（building-effective-agents / harness-design / writing-tools-for-agents / effective-context-engineering / memory / demystifying-evals / permissions）逐条对齐，可直接作治理标尺：

- **Agent = Model + Harness + Runtime + Tools + Context + Memory + Permissions + Observation + Evals + UI 的系统观**——与"评估的是模型+harness 联合体"一致，正是病(b) 的诊断框架。
- **Workflow（预定义代码路径）vs Agent（模型动态决策）是核心分类轴**——DesignEcho"去刻意路线"治理主线的权威依据。
- **最简优先、Workflow 优先于自由 Agent、单 Agent 优先于多 Agent**——砍多套重叠正则/固定流水线的标尺。
- **解耦"对话循环"与"业务逻辑"（业务只声明 tools/state/policy，运行时统管 stop reason/retry）**——直接对治病(b)。
- **无 Observation 不许宣称完成、Hallucinated Completion 是首要风险**——不可让渡红线。
- **Permissions=policy-as-code、default-deny、风险分级、不可逆操作强制 HITL**——PS 写操作不可逆，使其成 core。
- **工具设计（窄职责/结构化参数/对下一步有用的返回/带风险等级/小工具优于超级工具）、上下文工程（预算不是垃圾桶）、Memory 分层+污染防护+信任分级、Evals（评模型+harness）、Hooks（确定性优先、不要过多）、Structured Output schema 化、HITL 只在高风险节点、AG-UI 工作台**——全部可信可用。

### 别当事实的声明（`suspectClaims`，一律不得纳入选型/成本/代码）

以下来自 deep-research 报告、仅由不可核验的 `citeturn…` 浏览工具句柄支撑，是典型 LLM 编造，**禁止当事实**：

- Claude Managed Agents 的具体定价（$0.08/会话小时、web search $10/1000 次、单 session $0.705）与一切 ¥ 换算、汇率"1 美元≈6.7966 元"——伪精确、无真实来源，且 DesignEcho 无计费需求。
- `betas=["managed-agents-2026-04-01"]` beta 日期串与 `client.beta.managed_agents.create(...)` 伪 SDK 形态——无官方文档佐证，不可照抄。
- "Claude Fable 5 为受限接入的超长时自主代理模型"——不可核验推测，不作模型选型事实。
- "Claude Opus 4.8 具 1M token + adaptive thinking 等具体规格"——模型名可信（与运行环境一致），但具体规格引用前需查官方 model card。
- "Anthropic Managed Agents 已作 AaaS 与 Foundry/AgentCore/Gemini 并列竞争"整节——对已上线本地 Electron+UXP 应用完全不适用。
- 并发 fan-out"3–8 分支"、benchmark 样本数（SWE-bench 500 / AssistantBench 214）——作经验法则可参考，别当硬阈值。
- "十到十二周交付 / 26-38 人周"实施节奏——面向绿地企业团队，对本项目 V0/V1/V2 无参照意义。

一句话：**知识包 §41 的 22 条真实 URL 是可核验基线；deep-research 报告通篇 `citeturn` 句柄支撑的数字/日期/产品声明，事实层整体打折。**

### 对 DesignEcho 的 core / useful / skip

| fit | 条目 | 一句话理由 |
|---|---|---|
| **core** | Harness 分层与解耦 | 病(b) 就是 harness 耦合，"业务只声明、循环统管"是治本 |
| **core** | Workflow vs Agent 分类轴 / 去刻意路线 | 直接对应病(a)(b) 与治理主线 |
| **core** | Observation 门禁（无证据不宣称完成） | 视觉设计回读/截图是红线 |
| **core** | Permissions policy-as-code + 风险分级 + 不可逆 HITL | PS 写操作不可逆 |
| **core** | Tools 设计（命名/参数/返回/风险等级/小工具） | 对治工具身份散 6 文件 |
| **core** | Context Engineering（预算/动态加载/压缩保关键事实） | 长循环+reflexion 需控 context rot |
| **core** | Memory 分层 + 污染防护 + 信任分级 | 已有 auto-memory / H3 信任标记，可直接落 |
| **core** | Evals（golden/regression/rubric，评模型+harness） | 已有 smoke + assertion-scoring |
| **core** | Hooks（确定性优先/Stop-hook/不过多） | 恰是病(b) 过度硬编码的解药——约束而非扩 if |
| **core** | Structured Output / schema 化意图 | 病(a) 治本方向=模型声明式意图 |
| **core** | ReAct + Reflexion + ADaPT 按需规划 + Voyager | 已有循环 + reflexion-reentry-policy |
| **core** | AG-UI / Agent 工作台 UI | 桌面工作台形态吻合 |
| **core** | MCP | 已用 8768 暴露 PS 工具，收敛准绳 |
| **useful** | Plan-and-Execute / Evaluator-Optimizer | 映射 critic/reflexion 可用，但别恢复成强制前置门禁 |
| **useful** | Runtime durable execution/resume/回滚 | H1/H2 覆盖轻量部分，完整持久图是 V1-V2 增量 |
| **useful** | Guardrails / Sandbox | UXP 直改真实 PS 无法完全沙箱，只能"复制图层进临时文档"近似 |
| **useful** | Skills | 已有，但须守住"指导而非焊死"，防 `execute_skill` 旁路退化 |
| **skip** | Subagents / Multi-Agent | 当前单循环，治疗期先稳单 Agent，别为"更 agentic"提前拆 |
| **skip** | A2A | 单机单 Agent 无跨厂商生态 |
| **skip** | Agent-as-a-Service / Managed Runtime | 本地应用不上托管，且携带最多可疑定价 |
| **skip** | Computer-use（GUI 截图点击） | 已走 UXP/MCP API，现状即正解 |
| **skip** | 十二周绿地 gantt / 企业分工 / 云多租户 | 面向绿地企业，不适配已上线单机应用 |

---

## 2. 任务形态判定：哪些被错当自由 Agent、哪些确需模型动态决策

判据 = Workflow（可预定义代码路径、输入输出稳定）vs Agent（需模型在开放空间动态决策）。**不默认多 Agent 更好**——DesignEcho 当前是单自主循环，`design-teams` 单/多阈值仍是未决 openQuestion，治疗期先稳单 Agent。

| 核心流程 | 应然形态 | 当前实现 | 判定 |
|---|---|---|---|
| 中文指令 → 意图分类 | **Workflow（薄）+ 模型声明** | 5 套并行关键词分类器（控制面 / matchDeterministicIntent / skill-routing / resolveDesignTaskTypeSpec / inferTaskKind） | **错当 Workflow 硬路由**：应是"薄安全 scope + 模型声明式意图"，现在是厚关键词决策者，1 bit 误判改变全程 |
| 开放创意"做一张主图 / 详情页" | **Agent** | 已 autonomous（`control-plane:582→autonomous`） | 正确，勿动 |
| 规格子集（白底图 / SKU 导出 / 切片导出） | **Workflow** | `execute_skill` → 固定流水线 | 正确，属可预定义路径，保留但须去关键词入口误判 |
| 自主设计循环（ReAct + reflexion） | **Agent** | 已 autonomous | 正确，确需模型动态决策（构图/文案/工具序列开放） |
| 设计纪律门禁 | **Workflow 声明式 policy** | `evaluateDesignToolStateGuard` 9 个命令式 if + 强制 next-tool，焊进执行循环 | **错当循环内命令式牢笼**：纪律是"业务声明"，应下沉为运行时可解释的 policy 数据，不该驾驶通用循环控制变量（`agent.ts:2658-2688 / 2089`）|
| 破坏性 PS 动作（删图层/关档/覆盖保存） | **Workflow 硬门禁 + HITL** | 零守卫，仅一句 prompt 文本（`autonomous-agent.executor.ts:999`） | **该 Workflow 却完全裸奔**：安全必须是确定性代码 hook，不是模型自觉 |
| 顶层编排 | **显式 Workflow 决策表** | `engine.ts:3175-4000+` 14 分支 first-match-wins 控制流 | **隐式优先级藏在 800 行控制流**：应是显式可校验的两段式 classify→dispatch |

**结论**：DesignEcho 的病灶集中在**把两类任务放反了**——意图分类/设计纪律本应是"薄 Workflow + 模型 agency"，却做成厚关键词命令式牢笼；破坏性动作本应是"硬 Workflow 安全门禁"，却做成模型自觉。开放创意与自主设计循环的 Agent 定位是对的，不要为"更 agentic"去拆多 Agent。

---

## 3. 分层体检表

### 3.1 Harness / Runtime / Agent Loop / State

- **总体 verdict**：停止条件与停机分类是**强项**（`agent.ts:826` 迭代上界、`agent.ts:2987-3002` no_progress、`agent.ts:455-491` 熔断、`types.ts:157-166` StopReason 枚举、`autonomous-agent.executor.ts:1560-1602` reflexion 重入护栏）；循环与业务解耦是**weak**。
- **边界/职责**：通用循环应"拥有并统管"停止/预算/重试/工具结果；业务只声明 tools/state/policy。
- **输入输出契约（当前 vs 应然）**：
  - 当前：业务守卫经 `output.nextRequiredTool` 直接写通用循环的 `nextToolNameAllowlistForIteration`（`agent.ts:2658-2688` 读、`agent.ts:2089` 强制 allowlist、`design-discipline-runtime.ts:749-1071` 9 分支生产该字段）。策略被表达成对循环控制变量的写入。
  - 应然：业务返回 typed 决策（allow/redirect/block-and-observe/escalate），循环解释之，业务不碰控制变量。
- **风险点**：
  - **高**：守卫否决与真实工具失败共用同一通道（`autonomous-agent.executor.ts:538-544` 守卫结果即 `ToolResult{success:false}`），被 `executeToolWithFailureBreaker` 累加连续失败（3 次熔断该工具 `agent.ts:463-490`），被 `updateLoopGuards` 累加成 no_progress（3 轮停机 `agent.ts:2973-3002`）。**纯策略重定向就能熔断 placeImage、甚至以 no_progress 终止整个任务**——病(b) 在运行时层的放大器。
  - **中**：reflexion 重入 `new` 新 wrapper，`disciplineState` 被重置为全 false（`autonomous-agent.executor.ts:499,1631`）；上一轮 `documentCreated=true` 只活在软 brief 里不回灌，重入若正确跳过 createDocument 直接 placeImage，分支 4.1 会强制 createDocument（`design-discipline-runtime.ts:975-999`）——与续跑 brief 自相矛盾，复现"旁建空文档"。
  - **中**：两套续跑并存，live 循环只用软 H1/H2；重的 `agent-resume-controlled-execution` / `resumable-task-contract` 挂在旧 `engine.ts`，`autonomous-agent.executor.ts` 不在其消费方名单——能力"建好未接线"。
  - **低**：预算单维（迭代数），非设计任务无默认上限（`autonomous-agent.executor.ts:958-981` 返回 undefined），无 token/墙钟/成本停机维度。
  - 状态身份缺失：`runId` 是 `hash(goal)+hash(toolNames)` 事后生成（`agent-run-record.ts:145-148`），同 goal 重跑碰撞复用；无 task_id/step_id/call_id 三元贯穿。
  - 工具调用非事务边界：无幂等键、无回滚、无补偿（`tool-executor.service.ts:1858` 直执行无事务包裹）；undo 是模型工具非运行时事务（`tool-schemas.ts:844-847`）。重试写入可二次落地。

### 3.2 Tools / Action Space / MCP

- **总体 verdict**：MCP host 外部面板**强**（`mcp-host-service.ts:600-711` JSON-RPC 2.0 齐备、真 inputSchema、取消/断连 abort）；UXP 执行注册相对**干净**（`registry.ts:189-415` 唯一执行事实源）；单工具身份散布**partial/weak**。
- **边界/职责**：一个工具应有单一事实源，携带声明式风险元数据。
- **输入输出契约**：工具应声明 `riskLevel/sideEffect/requiresConfirmation`，返回可含顾问式 `suggestedNext`。当前 `ToolSchema`/`objectSchema` 只有 name/description/parameters（`tool-schemas.ts:4-13`、UXP `types.ts:23-37`），无任何风险元数据。
- **风险点**：
  - **高**：新增/改一个工具需同步约 6 处（tool-schemas 模型 schema、UXP registry、tool-display 显示名、preflight 与 photoshop-tool-skill 两套 scope Set、mcp-host 策略）；`audit:tools` 只覆盖前 4 处（`scripts/audit-tool-registry.cjs:21-64`），mcp-host 的 `inferToolKind/buildToolPolicy` 完全不在校验内，漏一处=能力半隐身或风险误判。
  - **高**：风险靠"工具名正则"猜且与手维护 Set 矛盾——`exportLayerAsBase64` 在 `photoshop-tool-skill.ts:72` 归只读证据工具，却因 `/^export/` 被 `mcp-host inferToolKind` 判为 export，在 `runPhotoshopBatch` 被 allowWrites 门禁拦截（`mcp-host-service.ts:1564-1568,1819`）。同一纯读工具被两套分类判成读与写。
  - **中**：两份模型向目录并存——`RAW_TOOL_CATALOG`（150，真 schema，被 audit，在用）vs `AVAILABLE_TOOLS`（99，字符串伪 schema，不被 audit，`getToolsListString` 零消费者=死代码但仍是执行分发命名来源，`tool-executor.service.ts:53,3789`）。
  - **中**：最小动作空间被耦合进纪律牢笼——只有纪律 active 才窄化工具集，通用态回到 ~150 平铺（`autonomous-agent.executor.ts:1088-1127`），能力级/任务级裁剪缺位。
  - **中**：前向"下一步"只有强制式 `nextRequiredTool`（9 分支注入、preflight 读回放行），无顾问式 `suggestedNext`，模型无法在保留 agency 前提下拿软建议。

### 3.3 Intent / Routing / Orchestration

- **总体 verdict**：**weak**——至少 5 套并行关键词分类器，同一句输入被多层各自正则重判。
- **边界/职责**：意图应"算一次、产出权威 Decision、往下游透传"；模型持路线 agency，关键词退化为弱信号 + 安全 scope。
- **五套分类器**：
  1. 控制面 `buildAgentIntentControlPlaneDecision`（主分类器，40+ 正则常量，`agent-intent-control-plane.ts:58-297,595-956`）。
  2. `routing.ts` `matchDeterministicIntent`（~14 个 `is*Intent` 正则挑 skillId，`routing.ts:840-1029`）。
  3. `skill-routing.ts`（数据驱动但夹 ~12 条硬编码 skill 专属 if，被两调用方用不同 exclude 各评一次，`skill-routing.ts:360-428`）。
  4. `design-task-types.ts` `resolveDesignTaskTypeSpec`（**病(a) 源头**：详情页/主图 `excludeSignals` 只有"导出当前"没有裸"导出"，`design-task-types.ts:104-108,309-317`）。
  5. `task-completion-contract.ts` `inferTaskKind`（完成校验时又重判，`hasCreativeDesignIntent` 正则 `.{0,5}` 与控制面 `\s*+量词` 松紧不一 = 宽严漂移，`task-completion-contract.ts:235-292`）。
- **输入输出契约**：控制面已在 `engine.run:3378` 算过一次并下传，但 executor/agent.ts/routing/conversational/ChatPanel 仍各自从原始文本重算（`buildAgentIntentControlPlaneDecision` 命中 6 文件 12 点）——无单一权威决策贯穿。
- **风险点**：
  - **高**：同一句并行穿过 ≥4 个独立分类器且各带不同 exclude 集，可给出互相矛盾结论（控制面判 explicit_creative_design 走自主循环，`resolveDesignTaskTypeSpec` 用另一套 exclude 从同一文本解析出"详情页"品类 spec）——矛盾面就是 bug 面，病(a) 即其一个实例。
  - **高**：agency 未真正归模型——Route10 确定性关键词路由在模型路由前直接短路（`engine.ts:3559-3603`），Route11 模型路由受控制面 `allowsRouterModel` 门控（`engine.ts:3605-3619`）。模型只能在关键词允许的窗口发言，1 bit 关键词误判即改变全程路线。
  - **中**：`skill-routing` 被两调用方用不同 exclude 各评一次，硬编码 skill 分支与控制面品类专属判定重复承担同一职责，改品类需多处同步。
  - **中**：编排藏在 14 分支 first-match-wins 控制流（`engine.ts:3175-4000+`），分支顺序=隐式优先级，无处校验。
- **正解基座已存在但未接线**：`design-intent-signal.ts`（信号/行为足迹判定、全程不读关键词，文件头自述要收敛"四套重叠分类器单一口径"，`design-intent-signal.ts:6-19,111-142`），目前只接进 executor 循环内纪律再激活（`autonomous-agent.executor.ts:452-476`），没替换任何顶层分类器，五套旧正则一条未删。

### 3.4 Observation / Permissions / Guardrails / HITL / Safety

- **总体 verdict**：Observation 通道**强**（`design-discipline-runtime.ts:755-758` 只读/查看类无条件放行含建画布前，26 项观察集 `:312-347`；UXP 观察工具容错良好 `get-document-snapshot.ts:12-24,200-218`）；Permissions**weak/missing**。
- **边界/职责**：安全应是全局最外层，独立于是否设计任务；工作流排序与安全必须分层。
- **风险点**：
  - **高（方向反了）**：安全被做成"设计工作流的子集"——破坏性动作保护只在设计纪律 active 时才可能存在，而 9 分支里根本没有破坏性分支（`design-discipline-runtime.ts:753 !active→null`、`:749-1070` 全是流程门禁）。**删图层/关档/覆盖在任何任务下零守卫**。
  - **高（病 b 复现路径仍在）**：workflow-sequencing + observation-exemption + 唯一安全性判定全压在单一 `context.active` 布尔上（`:164`），每分支强制 `nextRequiredTool`，模型无结构化推翻权（"可推翻 agency"是提示词补丁不是 policy 数据）。
  - **高（能力建好未接线）**：HITL 可编辑确认卡（`editable-confirmation-interactive-card.ts:204-296`）+ v5 审批溯源 `ApprovalRecord`（`agent-runtime-v5/approval-policy.ts:19-35`）+ undo 基础设施（`canvas/undo-redo.ts`）三样都在，但没有一个"风险分级 policy 表"把它们串起来；executor 完全不 import approval-policy。
  - **missing**：`deleteLayer` 直接 `layer.delete()`（`layer-properties.ts:419-421`）；`closeDocument` 直接 `closeWithoutSaving()` 丢未保存改动（`close-document.ts:80-85`）；`saveDocument overwrite:true` 覆盖（`save-document.ts:60`）——三者都不经任何确认，唯一约束是一句 prompt 文本（`autonomous-agent.executor.ts:999`）。
  - **中（假解耦印象）**：放行集是声明式 Set，但 `isAllowedDesignDisciplineTool` + 9 分支的顺序与条件是硬编码控制流，改一条要动函数体、对齐 109 条 smoke（`scripts/smoke-design-discipline-runtime.cjs`）。
- **强项保留**：设计轨"无 Observation 不许宣称完成"成立（`canClaimOutputQuality` 硬性要求 createdDocument/renderedStage/observationCount/savedDocument 全 >0，`design-discipline-runtime.ts:1107-1128`），但只在设计 active 时算，非设计任务无等价门禁。

### 3.5 Memory / Context / Evals / 可观测

- **总体 verdict**：指令记忆与事实记忆分离**强**（`design-memory-knowledge.ts:54-74`）；事实记忆防污染与生命周期**强**（learn 类先进 needs_review 人审、`UNSAFE_PATTERNS` 剥 base64/路径、注入只取 active limit 3 标"供参考"，`design-learning-memory-review-queue.ts:57-73`、`memory.service.ts:1212-1231`）；H1 Trace**强**（`agent-run-record.ts` 原子落 `.designecho/runs/<runId>.json`、reflexion parentRunId 链、拒 >1.5MB 与 base64）；H2 Trace→Resume 闭环**强**（`agent-run-resume.ts:76-140`）。持久化位置、压缩保事实、线上回归**weak**。
- **风险点**：
  - **高（双重失忆）**：上下文 trim（`context-manager.ts:168-182` 整轮删除无关键事实保护）与 Trace 档案截断（`agent-run-record.ts:115-118,232-235` 工具调用 400 上限保头尾丢中段）用同一结构弱点，同一关键事实可能同时从活上下文和审计档案消失。
  - **中**：事实记忆只落 localStorage（`memory.service.ts:322,777`），不随项目走、无法 diff/审计，与 Run Record 落项目目录自相矛盾。
  - **中**：系统提示 additively 拼接且 system 消息豁免 trim（`autonomous-agent.executor.ts:1507-1517`、`context-manager.ts:151-152,178`），每加一条治理段（designMemory/resumeBrief/dimensionSpec/designState/taskStateDiscipline）都往每轮上下文堆一块，可无界膨胀——"上下文是预算不是垃圾桶"只做了一半。
  - **中**：评估底座 H4 只能聚合已落盘档案，档案仅在"有 projectPath 且新 preload 桥就绪"时才写（`autonomous-agent.executor.ts:1288-1297`），无项目/旧 preload 运行静默排除——有偏样本。
  - **weak**：线上行为回归几乎为零——440 个 smoke 里约 235 个是读源码结构断言（接线守卫非产物质量），含模型的 smoke 多注入 mock 只验管道（`smoke-agent-step-events.cjs:40-55`）；金标 reference-replication 需人工跑真机 PS（`evaluate-reference-replication-result.cjs`），`buildRegressionCaseFromRunRecord` 产出 expected 一律留空（`agent-run-eval.ts:184-191`）。
  - **partial**：Trace 是摘要级非可回放（只留 argsKeys 无值 + ≤160 字摘要，`agent-run-record.ts:11-13`）；缺每模型轮次记录（不存 prompt/response/thinking）与视觉产物（`containsRawImages:false`），而视觉设计 Agent 失败多为"看+判断"失败，这两层恰恰缺席（`agent-run-record.ts:81-86,128-133`）。

---

## 4. 核心病与治本方向

### 4.1 病(a)"关键词硬路由"讲透

**机制**：意图判定由 5 套并行正则分类器承担，读用户措辞的"名词"匹配 `matchSignals`、用 `excludeSignals` 排除，命中即定品类。`design-task-types.ts:104-108` 的详情页 `excludeSignals` 只列了"导出当前/当前文档导出"，没有裸"导出"，于是"导出主图详情页"命中 `matchSignals` 的"详情页"、不命中 exclude → 被解析成"从零设计详情页"品类 spec（`:309-317`）。

**为什么补关键词治不了本**：`excludeSignals` 穷举不完裸动词——今天补"导出"，明天还有"输出/切片/交付/切图"。关键词分类器把"用户想干什么"(动词/意图) 降维成"文本里出现了什么名词"，方向性错误。且五套分类器各带不同 exclude，同一句可被判出互相矛盾的结论（控制面判 explicit_creative_design 自主循环，design-task-types 同时解析出详情页品类 spec）——矛盾面 = bug 面。

**治本方向 = 模型声明 + 弱信号**：
- 让 `design-intent-signal.resolveDesignIntentSignal`（已存在、不读关键词、`design-intent-signal.ts:6-19`）成为"是不是设计/什么设计"的**唯一口径**。
- 意图 = **模型声明式结构化输出**（Structured Output + schema 化 declaredTaskType），关键词从"硬路由决策者"降级为**弱信号 hint + 安全 scope 提供者**：Route10 不再短路模型，`deterministicRoute` 作为候选喂给 `classifyActionableIntent`（`task-classifier.ts:202-259` 已是真模型调用）。
- 仅保留真确定性工作流（系统闸/公开计划受控跑/matting 暂停/metadata 清单）在模型前；其余一律进模型路由。
- **行为等价保障**：先建"路由冻结基线"smoke（把已知病例集在三分类器的判定钉桩），重构必然触碰多层正则，先有可执行基线才能安全动刀。

### 4.2 病(b)"命令式牢笼焊进循环"讲透

**机制**：`createExecuteToolWrapper` 在真正 dispatch 前跑 `evaluateDesignToolStateGuard`，命中即 `return` 一个合成的 `ToolResult{success:false}`（`autonomous-agent.executor.ts:431-544`）。这个失败结果携带 `output.nextRequiredTool`，被通用循环 `resolveRequiredToolRecovery` 读取（`agent.ts:2658-2688`）、`applyRequiredToolRecoveryDirective` 把 `nextToolNameAllowlistForIteration` 焊成单一工具（`agent.ts:2089`）。9 个手写 if 分支就是这个字段的生产者（`design-discipline-runtime.ts:749-1071`）。

**放大链**：
1. 业务策略经**与真实工具失败相同的通道**驾驶通用循环控制流。
2. 守卫否决被 `executeToolWithFailureBreaker` 当普通失败累加（3 次熔断该工具 `agent.ts:463-490`），被 `updateLoopGuards` 累加成 no_progress（3 轮停机 `agent.ts:2973-3002`）。
3. 结果：一次任务类型 1 bit 误判 → 守卫常驻 → 逐轮把模型强制拉向单一工具 → 纯策略重定向就能熔断 placeImage、3 轮内以 no_progress 终止整个任务。**政策否决被升级成不可逆任务失败，agency 被运行时机械剥夺。**

**治本方向 = 声明式 tool-policy 表 + 统一裁决器取代 9 个 if**：

把 `evaluateDesignToolStateGuard` 拆成两个正交的数据驱动裁决器：

- **(a) SafetyPolicyDecider(tool, params) → { class, reversible, requiresReview, approval }**：声明表 `TOOL_SAFETY_POLICY`，默认拒绝不可逆高风险，**对所有任务生效**（安全非设计问题）。示例：`deleteLayer / closeDocument(save!==true) / saveDocument(覆盖)` → `{class:'destructive', reversible:false, requiresReview:true}`。
- **(b) WorkflowDisciplineDecider**：把 9 个 if 逐条改写为有序规则数组 `DisciplineRule[] = { id, applies(ctx,state,tool,params), block() }`，每条带 `overridableByModel` 标志——把现有"可推翻 agency"提示词补丁**固化成 policy 数据**。
- executor 先跑 Safety（全任务），再在设计 active 时跑 Workflow。给循环引入一等"策略决策"结果类型（`allow | redirect | block-and-observe | escalate`），与 `ToolResult` 区分；连续 redirect 设显式上限，达上限收敛到"观察 + 如实上报卡点"而非继续强制单工具。

**为什么这是行为等价、可被现有 51/109 smoke 兜住**：
- (b) 是**机械改写**——一条 if → 一个规则对象，文案与 `nextRequiredTool` 不变即行为等价。改写后 `node scripts/smoke-design-discipline-runtime.cjs` 的 109 断言仍应全绿，这就是等价性护栏。
- 同时把"政策否决"打上独立标记（`policyGate:true`），`executeToolWithFailureBreaker` 对它不累加失败、`updateLoopGuards` 不计入 allFailed 轮次——切断放大链，这一步不改任何守卫业务逻辑，只改运行时对守卫结果的会计口径。
- 最终 V2：循环不再 import 任何 `design-*` 模块，"牢笼"从焊进执行帧变成运行时可插拔策略层。

---

## 5. V0 / V1 / V2 治理路线

> 原则：别一次性做复杂系统。V0 先稳，V1 补能力，V2 治本。每阶段行为等价优先、smoke 兜底。

### V0 —— 先稳 / 低风险（补诊断、锁 smoke、放行已做）

| 维度 | 内容 |
|---|---|
| **目标** | 切断最危险的放大链、给已确诊病例止血、建行为冻结基线，不改判定语义 |
| **输入** | 现有 5 套分类器、9 分支守卫、已归档失败运行 |
| **输出** | ①"政策否决"与"工具失败"分通道；②病(a) 关键词补丁止血；③破坏性动作确定性 hook；④路由冻结基线 + 病例回归集 |
| **状态** | reflexion 重入用上一轮 checkpoint 播种 `disciplineState`（纯读档案旗标，无副作用） |
| **工具** | 观察类/导出类永远放行（已做）；破坏性动作缺 `confirmDestructive:true` 直接阻断 |
| **权限** | 新建 `TOOL_SAFETY_POLICY` 声明表，破坏性动作全任务生效（复用 `confirmNewDocumentDespiteExisting` 确认参数范式）|
| **上下文** | intake 抽取硬约束为 `pinnedFacts` 常驻块，放 trim 保护区外 |
| **记忆** | localStorage 事实记忆导出为项目级可读 JSON（只导出+回读，不改写入路径）|
| **评估** | 对已归档失败运行批量跑 `buildRegressionCaseFromRunRecord`，为病例人工补 expected；锁病例冻结 smoke |
| **失败恢复** | 破坏性动作执行前复用 acceptance before 快照留恢复点 |

### V1 —— 能力补齐（声明式 policy 表、轨迹 eval、可回放 trace、HITL 覆盖高风险）

| 维度 | 内容 |
|---|---|
| **目标** | 把风险等级从"猜"变"声明"、把 next 从"强制"变"软/硬两档"、把完成门禁与 HITL 普适化 |
| **输入** | V0 的 policy 表雏形、tool manifest 需求 |
| **输出** | ①工具定义引入 `riskLevel/sideEffect/requiresConfirmation` 单一声明字段，下游 Set 全由它派生；②读写分离+dry-run 下沉到模型主执行路径；③循环引入一等"策略决策"类型 + 连续 redirect 上限；④task_id+step_id+call_id 三元贯穿；⑤多维预算（迭代/token/墙钟/成本）各配 stopReason |
| **状态** | 完成宣称门禁上升为对所有 autonomous run 通用（有 mutation 但 observationCount=0 一律不得 completed）|
| **工具** | 通用路径按能力/任务裁剪（扩 `selectToolsForContext` 用声明 category），最小动作空间独立于纪律 cage |
| **权限** | editable-confirmation 卡片接到破坏性 policy（requiresReview 且无 confirm → 产确认卡而非硬错误），把"用户要求停卡"与"风险要求停卡"解耦 |
| **上下文** | 系统提示分段预算：测量各 section token、按优先级对可膨胀段设上限裁剪 |
| **记忆** | Trace 增每模型轮次层（选用工具/thinking 摘要已剥敏/observation 类别）+ 视觉产物引用（截图 hash+缩略图路径，非原始字节）|
| **评估** | 自动化金标行为回归（headless runner 跑 reference-replication，replay/mock provider 出 scorecard 增量对比）|
| **失败恢复** | 破坏性+save/export 动作持久化审批留痕（复用 v5 `ApprovalRecord` 形状写入 H1）|

### V2 —— 治本（意图解耦、Workflow 与 Agent 边界重划）

| 维度 | 内容 |
|---|---|
| **目标** | 循环与业务真正解耦、意图单一口径、编排显式化、工具单一事实源、工具调用成事务边界 |
| **输入** | V1 的声明式 policy 表、tool manifest、design-intent-signal 基座 |
| **输出** | ①反转耦合：业务只声明 `{tools, state reducer, policies}`，`evaluateDesignToolStateGuard` 从 wrapper 移出为运行时 dispatch 前"策略评估步"返回 typed 决策，9 if 降级为声明式前置条件（静态检查 `agent.ts` 对 `design-*` import 数=0）；②顶层编排重构为显式两段式 classify-once→dispatch，14 分支拆成显式表；③单一 tool manifest 作唯一事实源生成所有派生文件，`audit:tools` 退化为"生成物是否与清单一致"；④工具调用成事务边界（写类工具引入幂等键，写批次前后建 checkpoint/可回滚点，复用 placedLayers 实体锚）|
| **状态** | H1 checkpoint 提升为真正可还原的状态对象（disciplineState + 实体锚 + 步游标），reflexion 重入与用户续跑共用；下线挂旧 engine.ts 的 resumable-task-contract |
| **工具** | 关键词从"硬路由决策者"降级为"弱信号 hint + 安全 scope"，路线交模型（Route10 不再短路）|
| **权限** | Safety 与 Workflow 分层，agency 推翻权变结构化 policy 而非提示词 |
| **上下文** | 保事实压缩替换机械整轮丢弃：被驱逐轮次摘要并入 pinnedFacts 脊柱 |
| **记忆** | 事实记忆迁出 localStorage 到项目/用户级 file-backed 可版本化存储，人审队列成学习记忆唯一写入路径，与 `.designecho/` Trace 统一 |
| **评估** | 可回放 Trace 分层：可选全保真捕获（prompt+response+工具 IO）落隔离 artifact（gitignore、载荷守卫），支持确定性重放 |
| **失败恢复** | 单一状态化恢复路径，kill+resume 已完成步骤零重跑 |

---

## 6. 高风险 PS 操作清单 + 反模式清单

### 6.1 必须 HITL + 权限 + 可回滚的破坏性 PS 动作（现状缺什么）

| PS 动作 | 不可逆性 | 现状 | 缺什么 |
|---|---|---|---|
| `deleteLayer` | 高（图层丢失）| 直接 `layer.delete()`（`layer-properties.ts:419-421`），零守卫 | 缺确定性 hook / 确认参数 / before 快照恢复点 |
| `closeDocument`（save≠true）| 高（未保存改动丢弃）| 直接 `closeWithoutSaving()`（`close-document.ts:80-85`）| 缺"有未保存改动时需确认"门禁 |
| `saveDocument`（overwrite）| 高（覆盖源文件）| `overwrite:true`（`save-document.ts:60`）| 缺覆盖前确认 / 审批留痕 |
| `smartSave` / 覆盖原档 | 高 | 同上 | 同上 |
| `batchMorphToShape` / 批量变形 | 中高（批量不可逆改层）| 无 dry-run | 缺 preview / dry-run 预演 |
| `exportToSkuDir` / 批量导出 | 中（覆盖磁盘文件）| 无 dry-run | 缺 preview + 导出目标覆盖检查 |
| `placeImage` / `renderLayout`（写批次）| 中（重试二次落地）| 无幂等键、无事务（`tool-executor.service.ts:1858`）| 缺幂等键 + 写批次 checkpoint/回滚 |

**统一缺口**：无 `TOOL_SAFETY_POLICY` 声明表把风险等级、HITL 卡片（`editable-confirmation-interactive-card.ts`）、v5 审批溯源（`approval-policy.ts`）、undo（`canvas/undo-redo.ts`）串起来。三样基础设施都在，就差一张 policy 表接线——这是 V0/V1 最高性价比的补齐点。

### 6.2 反模式清单（DesignEcho 已犯 / 须避免）

1. **提示词水管工**：用一句 prompt 文本（`autonomous-agent.executor.ts:999` 的 `'non-destructive'`）代替确定性代码 hook 做安全治理——确定性规则必须用代码，判断性才用 LLM。
2. **政策否决 = 任务失败**：把可纠偏的策略重定向经失败通道升级成不可逆停机（`autonomous-agent.executor.ts:538-544` + `agent.ts:485-490,2973-3002`）。
3. **1 bit 误判放大全程**：单布尔 `context.active` + 强制 next-tool，一次分类错就笼死整个 run（`design-discipline-runtime.ts:164,768-1068`）。
4. **安全做成业务子集**：破坏性保护只在设计纪律 active 时存在，方向反了（`design-discipline-runtime.ts:753`）。
5. **关键词读名词代替意图理解**：`excludeSignals` 穷举裸动词（病 a，`design-task-types.ts:104-108`）——违背"理解优于硬编码"。
6. **多套重叠分类器各自漂移**：5 套正则、12 点重算、松紧不一（`agent-intent-control-plane.ts:200-208` vs `task-completion-contract.ts:280-282`）。
7. **风险靠名字猜**：`inferToolKind` 正则与手维护 Set 矛盾（`exportLayerAsBase64` 只读被判 export，`mcp-host-service.ts:1564-1568`）。
8. **工具身份散 6 文件、审计只覆盖 4 处**：mcp-host 策略层完全不在 `audit:tools` 内（`scripts/audit-tool-registry.cjs:21-64`）。
9. **能力建好未接线**（记忆库反复出现的病灶）：HITL 卡片/v5 审批/undo/受控执行状态机/ContextCompressor 都在但主路径不用。
10. **上下文垃圾桶**：system 消息豁免 trim + additively 拼接，治理段越加越膨胀（`autonomous-agent.executor.ts:1507-1517`）。
11. **假回归**：235/440 smoke 是读源码结构断言（接线守卫非产物质量），含模型 smoke 用 mock 只验管道。
12. **为"更 agentic"提前拆多 Agent**：当前单循环够用，`design-teams` 阈值未决，治疗期别拆。

---

## 7. 可直接执行的开发任务拆解（按 V0/V1/V2）

### V0（先做，低风险）

- **[V0-1] 政策否决与工具失败分通道**
  改：`autonomous-agent.executor.ts`（守卫合成结果打 `policyGate:true` / `stopReason:'policy_redirect'`）、`agent.ts:463-490`（`executeToolWithFailureBreaker` 对 policyGate 不累加 `consecutiveToolFailuresByName`）、`agent.ts:2973-3002`（`updateLoopGuards` 不计入 allFailed 轮次）。
  验收：新增 smoke——连续 N 次守卫否决 placeImage 后，failureBreaker 未熔断、`consecutiveFailedToolRounds` 未累加、任务未 no_progress 停机。

- **[V0-2] 病(a) 关键词止血**
  改：`design-task-types.ts:104-108`（详情页/主图/SKU `excludeSignals` 补裸"导出/输出/切片导出" + 否定守卫区分"导出"vs"不要导出"）。明确标注这是过渡补丁非根治。
  验收：扩 `scripts/smoke-intent-predicate-freeze.cjs`——断言"导出主图详情页""导出这张详情页"`resolveDesignTaskTypeSpec` 返回 undefined 且控制面不发 explicit_creative_design；既有干净句零回归。

- **[V0-3] 破坏性动作确定性 hook**
  改：`autonomous-agent.executor.ts:612` 之前新增 `TOOL_SAFETY_POLICY` 声明表 + 与设计无关的 pre-exec 破坏性 hook（`deleteLayer`/`closeDocument(save≠true)`/`saveDocument(覆盖)` 缺 `confirmDestructive:true` 直接阻断，给可诊断消息）。纯加法，非破坏性路径行为等价。
  验收：新增 smoke——`deleteLayer` 无 confirm→`success:false` 且消息含目标图层；带 confirm→放行；非设计任务同样被拦。

- **[V0-4] reflexion 重入播种 disciplineState**
  改：`autonomous-agent.executor.ts:499,1631`（重入时用上一轮 run-record checkpoint 播种 `createDesignDisciplineState({documentCreated,layoutRendered,placedLayers})`）。
  验收：smoke——`documentCreated=true` 的 checkpoint 播种后，重入首个 placeImage 不被强制回 createDocument，且不产生第二份画布。

- **[V0-5] 路由冻结基线 + 病例回归集**
  改：新增 smoke 用例集，把病例（导出/改文案/看看做得怎样/从零设计/白底图/SKU）在控制面+matchDeterministicIntent+resolveDesignTaskTypeSpec 三处判定钉桩；对已归档失败运行跑 `buildRegressionCaseFromRunRecord` 补 expected。
  验收：CI 绿，每例断言三分类器输出与人工标注一致 + `forbiddenBehaviors` 未发生。

- **[V0-6] 硬约束 pinnedFacts + exportLayerAsBase64 误判修正**
  改：intake 抽取尺寸/数量/禁止项为 `pinnedFacts` 放 trim 保护区外；`mcp-host-service.ts:1564-1568` 对已知只读 export* 建白名单。
  验收：扩 `smoke-context-manager` 断言超预算后早期尺寸约束仍在；单测断言 `inferToolKind('exportLayerAsBase64')==='read'` 且与 `classifyPhotoshopToolSkillExecution` 一致。

### V1（能力补齐）

- **[V1-1] 工具风险单一声明字段**：`tool-schemas.ts` 每条加 `riskLevel(read|write|export|destructive)+sideEffect+requiresConfirmation`，preflight/mcp-host 的 Set 全由它派生。验收：audit 断言各下游 Set = 按 riskLevel 过滤的结果（集合相等）。
- **[V1-2] 读写分离+dry-run 下沉主执行路径**：`executeToolCall` 前置基于声明 riskLevel 的策略，高爆破工具支持 preview。验收：harness eval——`deleteLayer` dry-run 返回预览不改文档；无确认的 destructive 被拦并给替代。
- **[V1-3] 循环引入一等策略决策类型 + redirect 上限**：`allow|redirect|block-and-observe|escalate`，连续 redirect 达上限转观察上报。验收：eval 统计单轮 redirect 分布在上限内、对照修复前后 railroad 率。
- **[V1-4] task_id+step_id+call_id 三元贯穿**：停用 hash(goal) 事后 runId，写进 messages/toolCallLog/run-record。验收：两次同 goal 产不同 task_id，run-record 与 toolCallLog 按 call_id 双向对齐。
- **[V1-5] 多维预算**：迭代/token/墙钟/成本各配 stopReason，非设计任务设默认 maxIterations。验收：逐维耗尽各触发对应 stopReason。
- **[V1-6] 完成门禁普适化**：`deriveDesignTaskRunEvidence` 的"无观察不宣称完成"升级为对所有 autonomous run 生效。验收：任意任务有 mutation、零观察→status≠completed。
- **[V1-7] HITL 接破坏性 policy**：requiresReview 且无 confirm→产确认卡（复用 `editable-confirmation-interactive-card.ts`）。验收：无 hasInteractionRequest 的任务对 deleteLayer 仍生成确认卡。
- **[V1-8] Trace 增模型轮次 + 视觉产物引用**：`agent-run-record.ts` 逐迭代记 {选用工具/thinking 摘要已剥敏/observation 类别} + 截图 hash+缩略图路径。验收：validate 仍拒 base64，但断言 `turns[]` 含 reasoning 摘要、`observationArtifacts[]` 含 hash+path。
- **[V1-9] 自动化金标回归**：headless runner 跑 reference-replication 出 scorecard。验收：`npm run eval:golden` 输出 pass/fail 与基线分数增减。
- **[V1-10] 系统提示分段预算**：测量各 section token 按优先级裁剪可膨胀段。验收：超大 memory/resume 输入后系统提示仍在预算内。
- **[V1-11] design-intent-signal 并轨完成侧**：`task-completion-contract.inferTaskKind` 用 `resolveDesignIntentSignal` 结果替换自带 `hasCreativeDesignIntent`。验收：一组"建文档+视觉+文案"足迹在两者下判定一致，此前误判 text_content_edit 的病例转 creative_design。

### V2（治本）

- **[V2-1] 反转耦合：守卫拆两个数据驱动裁决器**：`SafetyPolicyDecider`（全任务）+ `WorkflowDisciplineDecider`（9 if→有序 `DisciplineRule[]` 带 `overridableByModel`），`evaluateDesignToolStateGuard` 从 wrapper 移出为运行时 dispatch 前策略评估步返回 typed 决策。验收：静态检查 `agent.ts` 对 `design-*` import=0；机械改写后 `smoke-design-discipline-runtime.cjs` 109 断言全绿 + 新增 safety-table smoke；补一条场景 smoke——被误判"从零设计"的"导出既有主图详情页"不再被强制走 createDocument。
- **[V2-2] 顶层编排显式两段式**：`engine.run` 14 分支拆成"真确定性工作流前置分支 + 其余进模型路由"的显式表，优先级变可校验数据。验收：编排优先级 smoke——确定性分支集合被显式枚举、超出即 fail。
- **[V2-3] 关键词降级为弱信号**：Route10 不再短路模型，`deterministicRoute` 作候选喂 `classifyActionableIntent`；品类/纪律激活改挂模型声明 + 行为足迹。验收：harness eval 度量"关闭某条关键词正则后端到端路由不变"比例上升；skill-routing 双调用方合并为单次评估后 grep 无第二处品类专属分支。
- **[V2-4] 单一 tool manifest**：一份声明生成 tool-schemas/tool-display/preflight-skill Set/mcp-host 策略，`audit:tools` 退化为生成一致性校验。验收：CI 重新生成各派生文件 diff 为空。
- **[V2-5] 工具调用成事务边界**：写类工具引入幂等键，写批次前后建 checkpoint/回滚点（复用 placedLayers 实体锚）。验收：写批次中途失败后文档回到批次前 checkpoint；带幂等键重放同一写调用不产生重复图层。
- **[V2-6] 单一状态化恢复路径**：H1 checkpoint 提升为可还原状态对象（disciplineState+实体锚+步游标），下线旧 engine.ts 的 resumable-task-contract。验收：kill+resume 已完成步骤零重跑、画面与 kill 前一致、仅剩一条恢复代码路径被消费。
- **[V2-7] 保事实压缩 + 记忆迁出 localStorage**：压缩 pass 把被驱逐轮次摘要并入 pinnedFacts 脊柱；事实记忆迁到 file-backed 可版本化存储，人审队列成唯一写入路径。验收：长运行 smoke 断言早期约束经多轮 trim 后可从 pinnedFacts 复原；记忆可 diff，smoke 覆盖 approve→persist→supersede 且学习写入不绕过队列。

---

*本报告为综合评估，所有结论均引用五层审计提供的 file/file:line 证据。deep-research 报告中 `citeturn` 句柄支撑的定价/日期/产品声明已在 §1 明确剔除，不作为任何治理决策依据。*
