# DesignEcho Agent 开发方法论

更新时间：2026-05-05

## 1. 为什么需要这套方法论

DesignEcho 是一个长期演进的 Photoshop 设计 Agent，不是单次功能开发。项目已经出现过这些负面循环：

1. 被最新用户案例带偏，把 benchmark 当成能力。
2. 复盘写了很多，但没有形成下一次开发必须遵守的 gate。
3. 业务场景、skill、MCP/tool、benchmark、规划项边界混在一起。
4. 模型或工具返回“成功”后，没有足够 Photoshop 证据证明真实完成。
5. 用户提出“加入规划”的需求，如果没有进入真相源，后续容易被遗忘。

本方法论的目标是把开发从“连续补丁和连续复盘”转成“能力地图驱动、证据驱动、计划可恢复”的工作流。

## 2. 北极星

DesignEcho 的目标是会使用 Adobe Photoshop、并逐步具备设计判断能力的 Agent。

它要能：

1. 理解用户的真实设计意图。
2. 判断需要哪些素材、知识、模型和 Photoshop 操作。
3. 生成可编辑 Photoshop 结果。
4. 读取真实 Photoshop 状态验收。
5. 在失败或不确定时说清楚问题，而不是伪完成。

主图、SKU、详情页、参考图复刻、文案优化、抠图、局部重绘都是业务场景，不是项目边界。

FEX 这类样例是 benchmark，不是功能。

## 3. 每次开发必须经过的 8 个阶段

### 1. Intake：需求入池

任何新想法先判断归属：

1. Agent 基础设施
2. Photoshop 操作能力
3. 设计理解能力
4. 设计执行能力
5. 业务场景
6. Benchmark
7. 知识 / recipe
8. 工程治理

如果用户明确说“加入规划”，必须写入：

1. `project-memory/Intake.md`
2. `project-memory/Backlog.md`
3. 必要时同步 `project-memory/project-state.json`

禁止只在聊天里答应。

### 2. Orient：回读真相源

执行前必须按顺序回读：

1. `project-memory/Prompt.md`
2. `project-memory/CurrentTask.md`
3. `docs/documentation-governance.md`
4. `docs/design-agent-operating-system.md`
5. `project-memory/Plan.md`
6. `project-memory/Status.md`
7. `project-memory/Risks.md`
8. `project-memory/Decisions.md`

条件性阅读：

1. `project-memory/Intake.md`
2. `project-memory/Backlog.md`
3. `docs/agent-capability-map.md`
4. 任何专项 plan、历史 research、系统 review、借鉴文档

如果现有文档和用户最新要求冲突，先修正文档定位，再写代码。不得让专项 plan、历史研究或 scoped execution plan 越级指挥当前开发。

### 3. Classify：能力归类

每个任务必须回答：

1. 它属于能力地图哪一层？
2. 它是通用能力、业务场景、还是 benchmark？
3. 它应该是 skill、MCP/tool、executor、service、recipe、知识条目，还是 smoke？
4. 它会不会污染已有业务场景？

如果无法归类，不进入实现。

### 4. Evidence Check：证据检查

实现前必须确认当前事实：

1. 是否已有代码？
2. 是否已有 smoke？
3. 是否已有 live Photoshop 证据？
4. 是否只是模型输出或推断？
5. 是否只是单一 case 有效？

所有结论只能属于：

1. 已核实（代码）
2. 已核实（构建）
3. 已核实（smoke）
4. 已核实（live Photoshop / 手测）
5. 未核实 / 待验证

### 5. Design Gate：方案 gate

实现前必须通过这些问题：

1. 是否修根因，而不是加兜底掩盖？
2. 是否复用能力地图中的通用层，而不是给业务场景硬编码？
3. 是否影响 SKU、主图、详情页、参考图复刻、文档操作等既有路径？
4. 是否需要新增或更新 smoke？
5. 是否需要更新项目记忆？
6. 是否有性能、资源或用户体验风险？

任一问题无法回答时，先研究，不写大改。

### 6. Implement：小边界实现

实现原则：

1. 优先小步、可验证、可回滚。
2. 不混合工程治理、业务能力、UI、模型 provider、UXP 工具大改。
3. 不让 benchmark-specific 逻辑进入通用 skill 或 tool。
4. 不新增第二份真相源。
5. 不通过 prompt 硬编码代替真实路由、工具语义或验收。

### 7. Verify：验证

按风险选择验证：

1. 文档/规划：`npm run maintenance:validate`
2. Agent 路由：`npm run smoke:agent:intent-engine`
3. Agent runtime：`npm run smoke:agent:runtime-guard`
4. 可观测链路：`npm run smoke:agent:step-events`
5. UI 链路：`npm run smoke:chat-ui:execution-chain`
6. 参考图复刻：对应 reference smoke / benchmark
7. Photoshop 真实效果：显式 live smoke 或手测

验证失败时不能改报告掩盖失败，必须回到 Evidence Check。

### 8. Write Back：写回记忆

完成后必须写回：

1. `Status.md`：事实变化
2. `Backlog.md`：任务状态变化
3. `Risks.md`：新增风险或风险降低
4. `Decisions.md`：关键决策
5. `project-state.json`：机器可读当前焦点、nextActions、risks、lastValidation
6. `Intake.md`：如果用户规划项已处理，更新状态

## 4. 防偏航规则

### 规则 A：Benchmark 不升级为能力

FEX、海报样例、SKU 样例都只能验证能力点。不能因为一个样例跑通，就说 Agent 会设计。

### 规则 B：业务场景不成为边界

主图、SKU、详情页是业务场景。它们必须复用通用 Agent / Photoshop / 设计能力，而不是各自硬编码一套。

### 规则 C：工具成功不等于任务成功

工具返回 success 只能说明调用成功。任务是否成功必须看：

1. Photoshop readback
2. acceptance assertion
3. screenshot / bounds / diff 证据
4. executionSummary

### 规则 D：模型输出不等于事实

模型说“已完成”“已验证”“已保存”不能作为完成证据。完成证据必须来自工具、文件、Photoshop 状态或 smoke。

### 规则 E：复盘必须产出机制

复盘不能只产出总结。必须至少产出以下之一：

1. 新 gate
2. 新 smoke
3. 新文档规则
4. 新风险项
5. 新能力地图条目
6. 新任务入池项

### 规则 F：用户规划需求必须入池

如果用户说“加入规划”“纳入规划”“后续要做”，必须记录到 `project-memory/Intake.md`。如果不适合做，也要记录为 rejected / paused，并说明原因。

## 5. 负面循环识别

出现以下情况时必须停下来做方法论检查：

1. 同一个问题反复靠复盘讨论，但没有新增 gate。
2. 下一步规划反复围绕最新 bug，而不是能力地图。
3. 新功能绕过了 project-memory。
4. 一个 benchmark 被写进 skill / tool。
5. 用户问普通问题却触发 Photoshop 执行。
6. Agent 说完成，但用户肉眼看到没完成。
7. Pondering 出现硬编码伪思考。
8. 文档里出现“应该可以”“基本完成”但没有证据。

## 6. 最小开发模板

每次中大型开发都应按这个模板写内部结论：

```text
需求：
归属层级：
不是：
当前事实：
缺口：
方案：
影响范围：
验证：
写回：
```

如果填不完整，说明还没准备好进入实现。

## 7. 当前立即采用的 gate

1. 新需求先过能力地图分类。
2. 用户规划项写入 Intake。
3. benchmark 不进入 skill/tool。
4. 业务场景不能定义底层工具真相源。
5. 没有 Photoshop readback 的设计结果最多是“已执行 / 待验收”，不能写“设计完成”。

## 8. 严格开发顺序

从现在开始，开发顺序按以下阶段执行，不允许业务 skill 反向牵引基础设施主线。

### 阶段 0：文档治理与方法论收口

目标：

1. 收口真相源。
2. 固定默认阅读顺序。
3. 降级高干扰文档。

退出条件：

1. `documentation-governance.md` 生效。
2. `CurrentTask.md / Plan.md / project-state.json` 已同步。
3. 维护校验通过。

### 阶段 1：Agent 认知控制面

目标：

1. 用户需求必须先经过模型理解或明确的安全确定性规则。
2. 消除“问 A 做 B”“不经思考直接硬编码处理”“简单任务反而绕远”的核心傻问题。
3. 建立对话、澄清、机械 Photoshop 操作、开放式设计任务之间的稳定边界。

退出条件：

1. 简单问答不会误触 Photoshop。
2. 简单机械操作不会被开放式设计链路拖慢。
3. 开放式设计任务不会绕过模型理解直接硬编码执行。
4. UI 能展示真实公开思考或真实执行事件，不再用本地占位伪装思考。

### 阶段 2：Photoshop 执行控制面

目标：

1. 稳定 UXP / MCP / bridge 健康检查。
2. 让简单 Photoshop 操作可以真实执行、真实读回、真实报错。
3. 避免弹窗、无响应、桥接卡死和“工具成功但任务失败”的假完成。

退出条件：

1. disposable live 验收通过。
2. Photoshop bridge health 可稳定判定。
3. 简单图层/文档操作有真实 readback。

### 阶段 3：验收与 QA 控制面

目标：

1. 明确任务完成口径。
2. 把 execution trace、readback、截图、人工复核和失败原因收口到统一报告。
3. 让 Agent 在做错时知道自己没做完。

退出条件：

1. 任务报告区分执行成功、验收成功和质量待复核。
2. 没有 readback / QA 的路径不能宣称完成。

### 阶段 4：设计 Planner / 数据契约 / DSL

目标：

1. 把 DesignBrief、VisualUnderstanding、ExecutionPlan、VerificationReport 等契约真正接到运行时。
2. executor 只消费计划，不在执行时继续混合大量推理。

退出条件：

1. 通用设计任务能产生一致的中间表示。
2. 业务 skill 不再各写一套设计输入结构。

### 阶段 5：通用设计闭环

目标：

1. 先打穿参考图复刻这条通用闭环。
2. 证明 Agent 能“理解需求 -> 规划 -> Photoshop 执行 -> QA -> 修正”。

退出条件：

1. 至少有一条真实 Photoshop 通用设计闭环能稳定复现。
2. 不能再依赖单一 benchmark 冒充能力。

### 阶段 6：共享设计能力补强

目标：

1. 补强文本排版、Grid DSL、智能缩放、图片置入、素材理解、设计知识入口。
2. 这些能力必须作为共享层服务总控，不得直接写死到某个业务 skill。

退出条件：

1. 每项能力有独立证据和边界。
2. 共享能力被通用闭环真实消费。

### 阶段 7：业务 skill 集成

目标：

1. 把主图、详情页、SKU 作为子 skill 接到统一 Agent 上。
2. 它们只是场景，不是新的总架构入口。

退出条件：

1. `main-image-design`
2. `detail-page-design`
3. `sku-batch`
4. `ecommerce-design` 统一父 skill

都只消费通用 Agent 能力，不继续私长基础设施。

### 阶段 8：个性化与学习

目标：

1. 用户偏好。
2. 项目偏好。
3. 可复用 recipe 和记忆。

边界：

1. 只在前七阶段稳定后再进入。
2. 不能用“学习能力”掩盖基础能力不稳定。
