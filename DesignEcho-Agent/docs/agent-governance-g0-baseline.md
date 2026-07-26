# Agent 治理 G0 代码级基线

日期：2026-07-12

## 1. 文档定位

本文记录 `docs/agent-governance-implementation-objective.md` 中 G0 的代码事实、耦合基线和下一切片选择。

- 本文是已核实代码证据，不是新的控制平面。
- 总目标仍以 `project-memory/Prompt.md` 为准。
- 当前任务仍以 `project-memory/CurrentTask.md` 为准。
- 数值来自当前工作树；后续变化必须重新运行对应审计，不能把本文当动态 Registry。

## 2. 本轮已运行的只读审计

| 命令 | 当前结果 | 能证明什么 | 不能证明什么 |
|---|---|---|---|
| `npm run audit:executor-generic` | 通过，0 violation | `autonomous-agent.executor.ts` 已知品类控制流牢笼没有增长 | 不能证明 engine、routing、control-plane、skill-tools 已去品类化 |
| `npm run audit:tools` | 通过，151 个 Tool schema | 当前正则口径下 display、scope、UXP→schema 无缺项 | 不能证明分类正确、执行可达、参数一致或 UXP ToolRegistry 真注册 |
| `npm run audit:capability-resolver` | 通过，0 violation | 当前 Resolver 没有第二张 Capability Registry 或任务文本 fallback | 不能证明生产 R0 一定把选中 Skill 交给 Resolver |
| `node scripts/report-agent-architecture.cjs --json` | `architectureStatus=blocked` | 当前架构仍未成熟完成 | 报告中的文档/Smoke 存在不等于运行时 owner 已统一 |
| `npm run maintenance:business-skills-live-e2e:preflight` | `ready=false`，三 Skill 均 `partial_runner` | 现有 runner 源码标记和本机端口状态 | 源码字符串不是执行证据；TCP 可达不等于 UXP connected 或 E2E 通过 |

本轮端口 8765-8768 和 Ollama 均可达，但没有执行 Photoshop 写入。该事实只表示基础设施端口当前可连接。

> 2026-07-13 后续说明：本文保留的是 G0 当时的基线快照。G1 首个切片已经用 `runtime-session/v0` 替换“收尾从 Trace 重建 Stage State”和“Session 路径结束时另造 Run Record id”两段旧责任，并增加 R4 前写入门禁、R5 / E2 完成门禁和 Reflexion lineage。下文关于这些责任的描述用于说明历史根因，不代表当前实现仍未治理。R4 Scheduler、完整 Context / Evidence 和真实 Provider + Photoshop E2E 仍未完成。

## 3. 当前生产拓扑

```text
ChatPanel
  → DesignAgentEngine
  → autonomous-agent executor
  → v3 Agent ReAct loop
  → Tool / legacy Skill bridge
  → tool-executor / MCP / IPC / WebSocket
  → UXP ToolRegistry
  → Photoshop

运行收尾：
  v3 executionSummary + DesignVerdict
  → v5 Stage State / Trace shadow 重建
  → Agent Run Record digest
```

已核实：v5 当前是契约和影子证据层，不是实时推进全部阶段的唯一 Runtime owner。

## 4. R0-R5/E1-E2 Owner 基线

| 阶段 | 当前内容 owner | 当前推进 owner | 持久化 | 主要缺口 |
|---|---|---|---|---|
| R0 | Engine 模型/确定性候选 + runtime bundle manifest resolver | 收尾时 Stage State 自动补 R0 passed | Run Record 只存阶段摘要 | 结构化选中 Skill 在转 autonomous 时可能丢失 |
| R1 | Model 声明 Brief；Agent validator 与内存字段 | `brief_declaration` trace | Brief digest | 当前唯一真实下传给 Skill 的 v5 规划上下文 |
| R2 | 开工观察、只读 Tool、Context 服务和业务视觉门禁分散拥有 | 任意成功只读 Tool 可写 R2 | Trace / Stage digest | 无统一 Context artifact owner；只读 Tool 还会同时推进 E1 |
| R3 | Model 声明 Strategy；Agent validator 与内存字段 | `strategy_declaration` trace | Strategy digest | Strategy 没有传入业务 Skill executor |
| R4 | Model 声明 Action Plan；Harness 校验 DAG / Capability | `action_plan_declaration` trace | Plan / reconciliation digest | 明确 `schedulerAuthority=false`，不控制 E1 顺序 |
| E1 | v3 Agent 选择 Tool；legacy Skill executor 或原子 Tool 执行 | Tool result trace | Tool log / execution summary | 真正执行顺序仍由模型自由调用或 Skill executor 内部流程拥有 |
| R5 | executionSummary、TaskCompletion、Profile、DesignVerdict | Stage State 从最终 DesignVerdict 派生 | 质量摘要 | Stage State 是下游观察者，不是成败 owner |
| E2 | Skill / save-export Tool；Agent 收尾追加 delivery trace | 仅 R5 passed 且有 delivery evidence 时推进 | Stage / Run digest | legacy summary 可能先 completed，而 E2 仍 unobserved |

## 5. 已核实的双重真相源

### P0：R0 结构化 Skill 交接断点

1. `buildAutonomousSkillParams()` 只有 `decision.skillId` 存在时才写 `declaredSkillId`。
2. `modelDirectExecution: forbidden` 的 Skill 必须转入 autonomous ReAct。
3. Engine 当前会把这类不兼容直接执行的 `modelDecisionForAutonomous` 置为 `null`。
4. fallback 随后调用 `buildAutonomousSkillParams(context, modelDecisionForAutonomous, ...)`。
5. `resolveAutonomousCapabilityRuntime()` 只采信 `declaredTaskType` / `declaredSkillId`，不会采信文本推断 `skillId`。

因此模型已选中的主图、详情页、SKU 可能在真实 Engine→executor 路径丢失 Manifest 身份，静默进入 generic broad discovery。离线 system-path Smoke 直接注入声明，未覆盖这个断点。

### P0：R4 与 E1 两套计划

- R4 目前只做 shadow declaration / reconciliation。
- `SkillExecuteParams` 只下传 R1 Brief，没有 R3 Strategy 或 R4 Plan。
- 业务 executor 仍拥有真实动作顺序。

### P0：Stage State 与任务成败两套状态

- Stage State 明确 `evidenceOnly=true`、`changesTaskResult=false`。
- Agent 先建立 executionSummary，再重建 Stage State。
- 最终 success 读取 executionSummary，不读取 Stage State。

### P1：其他旁路

- 成功只读 Tool 当前既可记录 R2，也会记录 E1。
- public-plan controlled runner 成功时可不回 autonomous runtime。
- ChatPanel 个别图片生成/快捷路径在统一 Agent 前返回。
- v5 旧 `WorkflowRun` 合约仍存在，但对应 orchestrator 已移入 archive，生产 Agent 不消费该状态。

## 6. 品类耦合基线

### 已清理或未增长

- `autonomous-agent.executor.ts` 的旧详情页状态机、品类 Tool cage、品类 Prompt 注入：当前审计 0 violation。
- `design-discipline-runtime.ts` 过渡债务未增长：
  - framework Skill 映射：2
  - task extra Tool 映射：3
  - exposed extra Tool 映射：0
  - 详情页 validator 标识符引用：2

### 仍改变通用控制流的主要位置

| 优先级 | 位置 | 当前品类责任 |
|---|---|---|
| P0 | `shared/agent-intent-control-plane.ts` | 品类正则影响授权、确认和 Tool scope |
| P0 | `agent-orchestration/routing.ts` | 主图 /详情页 /SKU 正则影响候选 Skill、参数和 route |
| P0 | `design-agent/engine.ts` | SKU 参数改写、业务旁路和部分品类失败语义 |
| P0 | `skill-executors/skill-tools.ts` | 通用 bridge 内嵌 SKU 模板阶段 handoff |
| P1 | `agent-design-execution-preflight.ts` | 三类 scenario / planner 特判 |
| P1 | `business-skill-visual-evidence-gate.ts` | 三类视觉证据场景和素材筛选分支 |
| P1 | `skill-param-defaults.ts` | SKU /主图参数推断泄漏到共享层 |
| P1 | `design-task-types.ts` | 与 v5 Manifest / Skill declaration 重叠的过渡数据基座 |

合法品类内容仍应保留在 Skill manifest、Skill declaration、品类 executor / helper、Evaluation Profile 和 UXP 原子 Tool 中。

## 7. Capability / Tool 身份基线

当前实测：

- 原子 Tool schema：149
- 队友 Tool：2
- Skill schema：15
- 生产候选合计：165
- Capability inventory：141
- 当前重复 capability id：0
- 当前 unclassified：0

身份仍分散在 Tool schema、默认暴露表、旧 `AVAILABLE_TOOLS`、display、preflight、Tool semantics、Capability bridge、执行分派、UXP Tool / Registry 和 Skill manifest。

已核实旧 `AVAILABLE_TOOLS` 与当前原子 schema 漂移：109 项旧表；相对当前原子 schema 缺 45，额外 5。它不是主 catalog owner，但仍是维护风险。

现有 `audit:tools` 只做正则存在性检查；后续需要结构化 identity ledger，但不能新建第二张执行 Registry。ledger 必须从真实 catalog、semantics、executor 和 UXP registry 派生。

## 8. 三类 Skill live E2E 缺口

| Skill | 已有 | 缺口 |
|---|---|---|
| 主图 | disposable opt-in、真实 Photoshop adapter、写后读回、QA | 生产 Agent、真实 Provider、Manifest stages、选中 Skill bridge、E2 delivery |
| 详情页 | 真实 Agent、ModelService、Photoshop Tool、读回 | 使用固定 13 Tool；绕过 production autonomous entry、Capability Session、Manifest、Skill bridge、正式 Evaluation / E2 |
| SKU | disposable output、直接 MCP、文件读回、snapshot | 生产 Agent、Provider、Manifest stages、Capability Session、Skill bridge、正式 Evaluation / E2 |

三条 runner 即使分别写通，也不能证明“同一个 Harness 下的三个 Skill”已经完成。

## 9. G0 结论与首个实施切片

G0 当前未知项已经转为显式债务。第一个高收益切片确定为：

`R0-SELECTED-SKILL-HANDOFF-001：结构化 Skill 选择交接 + Manifest fail-closed`

原因：如果 R0 没有把模型已选 Skill 交给生产 Runtime，R1-R5/E1-E2、Capability、Policy 和 Evaluation 都不会启用；此时先做 Scheduler 或扩 Skill 只会治理到旁路。

切片验收：

1. `modelDirectExecution: forbidden` 的 business-workflow Skill 转 autonomous 时保留结构化 Skill identity。
2. Engine 不按主图 /详情页 /SKU 字面分支，仅读 Skill declaration。
3. executor 对显式选中 Skill 必须解析出 Manifest；失败时停止且不调用模型 / Photoshop。
4. 输出 `runtimeContractStatus=resolved|no_skill_selected|selected_manifest_missing`。
5. 主图、详情页、SKU 都获得自己的 Manifest、8 阶段计划和 Capability Session。
6. 显式未知 Skill 不猜测、不回 generic broad discovery。

后续优先级：

1. 建立增量 Runtime Session owner，阻断 R4 未 ready 的写入和 R5 未通过的 E2 / completed。
2. 将 SKU legacy bridge policy 移入 Manifest 引用的 Skill Policy provider。
3. 让 R3 / R4 结构化上下文进入被选 Skill，并逐步收口真实 E1 顺序。
4. 用真实 run record 替代 live readiness 的源码字符串 marker。

## 10. 2026-07-13 G1 跟进

G0 的首个 R0 selected-Skill handoff 已完成。其后的 `AGENT-GOVERNANCE-G1-RUNTIME-SESSION-001` 第一切片已经接入 manifest-bound 生产路径：

1. executor 在 Agent 运行前签发 session / run / generation identity；Reflexion 保持 sessionId，generation 单调递增，parentRunId 指向上一代。
2. `runtime-session/v0` 在运行中持有 Stage State；Stage Trace 只追加 observation，Agent 不再在收尾从 Trace 重建 State。
3. R4 未 ready 时状态变更 Tool 在 dispatch 前 fail closed；一次写入成功不能直接进入 R5，后续读回是必要证据。
4. R5 只接受唯一 DesignVerdict；E2 还要求真实交付 Evidence，与 Session 不一致的 `completed` 会降为 `needs_review`。
5. Run Record 使用预签发 runId 并校验 Session digest；Resume 来源身份只用于审计，不自动恢复活动 Session。
6. 归档 `WorkflowRun` 未被复活，因此没有新增第三套 Runtime 或品类状态机。

验证结果：Runtime Session 19/19、Reflexion 7/7、agent-fast 83/83、Renderer 类型检查和完整构建通过；主入口 650.96 kB，既有大块警告仍存在。

尚未完成：开放式无 Manifest 设计路径、完整 R2 / E1 Evidence artifact、跨用户续跑、Brief / Strategy / Plan 跨代承接、R4 可执行 DAG、真实 Provider +一次性 Photoshop 多代 E2E 和商业设计质量证明。G0 本文前文继续作为 2026-07-12 历史基线，不能被当作当前实时拓扑。

### 第二切片跟进

G1 第二切片已经替换“新 Agent generation 无条件清空全部规划声明”和“Reflexion 回退后保留 target /下游旧通过状态”两段责任：

1. `runtime-planning-context-seed/v0` 绑定同一 session、source / target run、generation、Stage Plan 和 target stage。
2. 只承接 target 之前的 ready 模型声明；target 及下游 State /声明失效。回退 R4 只保留 Brief / Strategy，回退 E1 才保留 Plan。
3. Agent 在建立模型消息前校验 seed；缺失或篡改时在模型 / Photoshop 前 fail closed。
4. Skill bridge 已消费 R3 Strategy / R4 Plan 只读上下文；Plan 的 shadow-only 与无调度权边界不变。
5. Run Record 只保存 planning-context digest，不保存完整声明，也不允许 Resume 自动恢复活动 Session。

验证更新：Planning Context 10/10、Runtime Session 19/19、Reflexion 8/8、agent-fast 84/84、Renderer 类型检查、完整构建和 Capability audit 通过。主入口 662.70 kB，较第一切片增加 11.74 kB；真实 Provider + Photoshop 多代 E2E、跨进程恢复和 E1 节点级 Evidence 仍未完成。
