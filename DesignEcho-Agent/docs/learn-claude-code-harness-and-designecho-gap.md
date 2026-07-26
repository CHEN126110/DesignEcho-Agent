# learn-claude-code Harness 框架 × DesignEcho 差距分析

> 来源：开源项目 [shareAI-lab/learn-claude-code](https://github.com/shareAI-lab/learn-claude-code)（6.9万 star，"从0到1教 Agent Harness 工程"，12个已实现阶段 s01–s12）。
> 本文 = 上半部分蒸馏其 harness 框架，下半部分逐要素映射回 DesignEcho 现状、指出短板与修复优先级。
> 编制：2026-07-01。凡涉及 DesignEcho 代码的断言均带 file 依据；未核实处标注"待核实"。

---

## 一、核心命题（它对"Agent"的定义）

- **Agency 来自模型训练，不是编排代码。** Agent 产品 = **模型 + Harness**。模型是驾驶者，harness 是载具。
- **Harness = Tools + Knowledge + Observation + Action Interfaces + Permissions**。
  - Tools：文件/Shell/网络/数据库/浏览器……模型能触达的动作。
  - Knowledge：产品文档、领域资料、API 规范、风格指南（按需加载，不前置塞入）。
  - Observation：git diff、错误日志、画面状态、传感器——真实反馈如何回到模型。
  - Action：CLI/API/UI 交互——控制流如何推进。
  - Permissions：沙箱、审批、信任边界——结构上禁止什么。
- **反模式："提示词水管工"**——用 if-else 分支、节点图、关键词/正则路由、固定流水线把 LLM 楔进去当文本补全节点。它称之为"有宏大妄想的 shell 脚本"、"GOFAI 符号规则系统喷了层 LLM 漆"，**不是 Agent**。
- **Claude Code 之所以优雅，在于它不做什么**：不试图成为 Agent 本身、不强加僵化工作流、不用决策树替模型判断。给够工具/知识/上下文/权限，然后**让开**。

---

## 二、四条元原则（贯穿 s01–s12）

1. **Agency 来自模型，harness 别替模型做决策。** 路径由模型在循环里动态生成；工程只负责"能从数据结构确定性算出的事实"（哪些解锁了/哪些被卡），不负责"下一步做什么"。
2. **挂在循环上，不写进循环里。** 新能力 = 往数据层（注册表/知识目录/任务图）加一条数据；agent loop 内核从 s01 到 s12 **一字未改**（工具从1个扩到十几个）。
3. **按需加载，不前置塞入。** 常驻的是廉价索引（名字/摘要/能力清单），昂贵正文只在真正用到时经 tool_result 取出、用完即弃。
4. **长命状态外化到磁盘，会话是易失的。** 跨会话/压缩/崩溃需存活的目标/身份/协调状态，落到对话之外的持久介质。
5. *(半条)* **错误是结构化反馈，不是崩溃或吞噬。** handler try/except 转可读字符串回灌模型；未命中返回带可用列表的明确错误。

---

## 三、12阶段机制速查（按五要素归位）

| 阶段 | 机制 | 主要 harness 要素 | 一句话 |
|---|---|---|---|
| s01 the-agent-loop | while 真循环 + 单一停机条件 `stop_reason != tool_use` + 累积 messages | Action/Observation | 一个工具+一个循环=一个 Agent；内核永不改 |
| s02 tool-use | 双注册表（TOOLS schema + TOOL_HANDLERS dispatch map）+ safe_path 沙箱 + 失败即结构化字符串 | Tools/Permissions | 加能力=加数据，不加分支 |
| s03 todo-write | TodoManager 外化计划（单 in_progress）+ 3轮不更新就 nag | Knowledge/Tools | 计划是护栏不是脚本，模型自己列 |
| s04 subagent | task 工具起 fresh 子循环、丢弃过程只回摘要、子集无 task 防递归 | Observation/Permissions | 隔离换干净上下文，守护主注意力 |
| s05 skill-loading | 两层注入：目录摘要常驻 + load_skill 取正文 | Knowledge | 名字常驻、正文按需，模型自主拉取 |
| s06 context-compact | micro（每轮静默降级旧结果）/auto（阈值落盘+摘要）/compact（模型主动）三层 | Knowledge | 战略性遗忘、可恢复、无限会话 |
| s07 task-system | 磁盘 JSON 任务图 DAG（status+blockedBy，完成即解锁） | Knowledge/Action | 比对话长命、可表达依赖的目标图 |
| s08 background-tasks | 守护线程异步发起 + 通知队列，LLM 调用前排空注入 | Action/Observation | 并行的是执行，串行的是判断 |
| s09 agent-teams | 持久命名队友 + config.json 名册 + 每人一个 JSONL 邮箱（读后清空） | Action/Observation | 协作=共享状态+异步消息+各自自治循环 |
| s10 team-protocols | 唯一 request_id 请求-响应握手 + pending→approved/rejected 状态机 | Action/Permissions | 一份协议复用到关机/审批 |
| s11 autonomous | 看板拉取取代指派：idle+claim_task 原子认领、WORK/IDLE 双阶段、压缩后重注入身份 | Action/Observation | Agent 自己扫看板认领，水平扩展 |
| s12 worktree-isolation | 控制平面(.tasks JSON)+执行平面(worktree+独立分支) 靠 task_id 绑定 + events.jsonl | Permissions/Action | 冲突靠结构消灭，不靠口头约定 |

---

## 四、DesignEcho 五要素差距分析

> 结论先行：**DesignEcho 缺的不是机制，而是"接线的严谨"和"没把决策权彻底还给模型"。** 大部分机制我们都有雏形甚至完整实现，但两个系统性问题拖累了它——(a) 历史上重度依赖"替模型决策"（关键词路由/固定流水线），正是它批判的水管工反模式；(b) 主循环反向过度工程化（塞了太多续跑/兜底分支），违背"挂在循环上不写进循环里"。

### Tools —— 有，较强，但注册不单一源
- **现状**：`tool-schemas.ts` 的 `RAW_TOOL_CATALOG`（~40 工具）+ `tool-executor.service.ts` 的 dispatch 派发，结构上正是 s02 的双注册表。技能也以工具形式暴露（`buildSkillToolSchemas`）。
- **短板**：一个工具的身份散落在 ~10 个文件（见记忆 [[tool-registration-coupling]]），违背 s02"两处登记"的干净约定；刚修掉的 `createInteractiveCard(sku_combo_editor)` 影子路径就是"工具绕过正路"的典型（见 [[sku-combo-card-shadow-path-fix]]）。
- **对标**：s02 主张能力增减纯发生在数据层、单一 dispatch。**动作**：收敛到单一工具注册表 + `audit:tools` 校验（已起步）。

### Knowledge —— 组件齐、接线弱（"建好未接线"）
- **现状**：`design-principles.ts`（设计原理底座）、`searchDesignKnowledge`、技能库、`context-manager.ts`（上下文压缩存在）。
- **短板**：知识常常没真正进到模型的决策链 → "凭空设计"（见 [[design-capability-infrastructure]] [[design-capability-governance-audit]]）。这对应 s05 的核心：**能力清单要摆在模型手边、由模型自主 load**，而不是建好挂在某个 skill 上不接入自主循环。
- **缺失**：**无 s07 式持久任务图 DAG**（已核实：仅 agent.ts/sku-batch 有零星 task 字样，无 `.tasks/` DAG）。跨会话的结构化目标+依赖是空白。
- **对标**：s05 两层按需加载 + s06 分级可恢复压缩 + s07 持久任务图。**动作**：把"建好未接线"的知识按 s05 暴露为循环内可选工具；评估是否需要 s07 任务图承载多屏/多交付的依赖。

### Observation —— 机制在，接线脆（bug 集中地）
- **现状**：`getAnnotatedSnapshot`、视觉证据注入（`attachToolImageEvidence`）、只读证据回读。
- **短板**：观测→动作的接线不稳。**刚定位的 SKU 停机 bug 就是这一类**（见下节案例）：工具结果里卡片在 `data.interactiveCards`，而闸门读 `interactiveCards` 顶层，路径对不上。历史上也有"视觉证据没进规划链路"（见 [[v5-visual-evidence-gate]] [[image-understanding-selection-diagnosis]]）。
- **对标**：s01 的核心就是 tool_result 忠实回灌 + tool_use_id 对齐。**动作**：审计所有"观测/证据回灌"点的路径一致性（见修复优先级 P0）。

### Action Interfaces —— 有，但**反向过度工程化**（DesignEcho 最独特的问题）
- **现状**：`agent.ts` 的 `Agent` 类是 ReAct 循环，但**积累了大量续跑/兜底/纠偏分支**：`updateLoopGuards`、`applyRequiredToolRecoveryDirective`、`promisedToolNoCallReplanAttempts`、`contractRemediationAttempts`、completion-contract、多种 replan 计数器……
- **短板**：s01 的循环是**一个**干净停机条件 + 路径全交模型；DesignEcho 的循环塞进了太多"替模型决定要不要继续/该调什么"的启发式。**SKU 停机 bug 正是症状**：续跑路径太多，只要一道停机闸门路径没接对，模型就被各种"继续执行"的推力带着跑飞（截图1建图层）或被 completion 草草判完（截图2）。这违背元原则2"挂在循环上，不写进循环里"——本该是数据/工具决定的东西，被写进了循环控制流。
- **对标**：s01 单一停机 + s03 用"单 in_progress + nag"这种**轻量护栏**替代重度续跑逻辑。**动作**：把停机/续跑收敛到一小组清晰条件；用外化计划（s03/s07）替代循环内的隐式续跑推力。

### Permissions —— 结构直觉对，接线有 bug
- **现状**：`confirmed_tool_required` 授权、停机闸门（`collectPendingInteractiveConfirmationCards`）、denylist（sku-batch 不可直执）、按上下文的工具白名单（`selectToolsForContext`）。这些正是 s02/s04/s10/s12 的权限结构直觉。
- **短板**：闸门/白名单的**接线**出 bug（SKU 停机闸门路径不匹配就等于权限边界形同虚设）。
- **对标**：s12"冲突靠结构消灭不靠口头约定"、s04"工具白名单结构性禁递归"。**动作**：把审批/停机闸门做成鲁棒且有测试守护的结构（P0 修复 + smoke 钉桩）。

---

## 五、活案例：SKU 停机 bug = 一个教科书级 harness 缺陷

- **现象**：出了 SKU 组合确认卡后，本该停机等用户确认，却有时继续在文档里建图层组（截图1）、有时被判"任务已完成"（截图2）——"反正什么情况都有"。
- **根因**（已读码实证）：停机闸门 `collectPendingInteractiveConfirmationCards`（`agent.ts:373`）只识别 `result.output.interactiveCards`（顶层）；但 sku-batch 把卡片放在 `result.output.data.interactiveCards`（`sku-batch.executor.ts:4056`）。UI 从 `data.interactiveCards` 读卡能显示（`ChatPanel.tsx:3485`），但闸门读顶层读不到 → **不停机**。
- **harness 视角**：这是 **Permissions 要素（审批/信任边界）的机制没接对**。用 learn-claude-code 的话说——不是缺功能，是"接线"漏了；而循环里 Action 层过多的续跑启发式（Action 反向过度工程化）放大了后果。
- **反讽**：上一轮我把卡片从"影子路径 createInteractiveCard（卡在顶层，闸门能识别→会停机）"引到"sku-batch（卡在 data 下，闸门识别不到）"，修对了 Tools 层的单一来源，却暴露了 Permissions 层这道旧漏洞。
- **修复方向**：让闸门同时识别顶层与 `data.interactiveCards`，并统一"执行器返回卡片的位置约定"（根因级，非兜底）。

---

## 六、修复/演进优先级（给 DesignEcho）

**P0 · 修停机闸门（Permissions 接线）** —— 就是上面这个 bug。让 `collectPendingInteractiveConfirmationCards` 识别 `output.interactiveCards` 与 `output.data?.interactiveCards`，加 smoke 钉桩。改完即消除"出卡后建图层/被判完成"两种飞车。

**P0.5 · 审计所有"证据/卡片回灌"点路径一致性（Observation）** —— 系统性排查是否还有别的执行器把观测放在 `data.*` 而消费方读顶层。

**P1 · 收敛主循环续跑逻辑（Action，元原则2）** —— 盘点 `agent.ts` 里的续跑/兜底/replan 分支，把"替模型决定要不要继续"的启发式尽量外化成 s03 式轻量护栏（单焦点+提醒）或 s07 任务图，让停机/续跑回归少数清晰条件。

**P1 · 继续清关键词路由（元原则1，已在做）** —— `routing.ts` 的 `matchDeterministicIntent`/`isSkuIntent`、control-plane 关键词信号仍是"替模型决策"。方向已对（见 [[agent-architecture-best-practices]] [[main-image-scripted-route-governance]]），继续把技能纯作为模型可选工具，退役关键词路由。

**P2 · 单一工具注册表（Tools，s02）** —— 收敛 [[tool-registration-coupling]] 的 ~10 处登记。

**P2 · 接线"建好未接线"的知识（Knowledge，s05）** —— 把 `design-principles`/`searchDesignKnowledge` 等按 s05 两层法暴露进自主循环，治"凭空设计"。

**P3 · 评估持久任务图（Knowledge，s07）** —— 若多屏/多交付需要显式依赖与跨会话存活，引入 `.tasks` 式 DAG。

**自检一句话**（每次动 agent 代码前问）：**我在"替模型决策"还是"给模型机制"？** 偏前者就是掉进了水管工反模式。

---

## 附：完整通用蓝图与五要素归位表见本仓库对话记录（workflow 蒸馏产物），本文只保留对 DesignEcho 有直接指导意义的部分。
