# Design Planner MVP 实施计划

日期：2026-05-11

## 1. 文档定位

本文件细化 AGENT-014：Design Planner MVP。

Design Planner 是 Design Agent OS 中连接“理解需求”和“调用 Photoshop 工具”的控制层。它不是新的业务技能，也不是新的硬编码路由；它负责把已有的用户意图、设计简报、视觉理解、素材理解、知识检索、智能缩放和验收目标组织成统一的 `DesignDSL` 与 `ExecutionPlan`。

当前项目已经有主图、详情页、SKU、参考图复刻、文案撰写、知识搜索、智能缩放和 Photoshop 验收的局部能力，但仍缺少一个稳定的 planner 层。因此 Agent 容易表现为“调用工具集合”，而不是“理解设计目标后组织执行”。

## 2. 要解决的真实问题

1. 用户提出“帮我做主图/详情页/SKU/参考图复刻”时，系统常直接进入某个 executor，缺少统一设计 brief。
2. 参考图、图片素材、知识搜索、文案框架、智能缩放各自有 evidence，但没有被统一进入执行计划。
3. executor 里仍混合了一部分推理、上下文整理和执行，后续难以维护。
4. 工具成功返回后仍容易被误判成任务完成，缺少 planner 级验收目标。
5. 新能力容易继续变成孤岛，导致主图、详情页、SKU、文案、缩放、知识各写各的规则。

## 3. MVP 目标

第一阶段只做“规划层可验证”，不追求审美质量提升。

目标：

1. 输入用户需求和已有上下文，输出统一 `DesignBrief`。
2. 从现有 evidence 选择可用的素材、视觉、知识和约束。
3. 输出一个保守 `DesignDSL` 或 `ExecutionPlan`，说明准备做什么、依赖什么、缺什么证据。
4. 给出 `VerificationReport` 预期验收口径。
5. 首个场景优先接参考图复刻或主图草案，但不改变现有 Photoshop 工具参数。

## 4. 非目标

1. 不承诺一轮实现高质量自动设计。
2. 不替换现有主图、详情页、SKU executor。
3. 不让知识搜索结果直接触发 Photoshop action。
4. 不把智能缩放 planned destinationBox 当成执行后结果。
5. 不绕过现有 Photoshop acceptance。
6. 不把 UXP 面板工具自动开放为 Agent skill。
7. 不暴露私有 chain-of-thought，也不新增伪思考。

## 5. Planner 输入

MVP 输入结构建议命名为 `DesignPlannerInput`。

字段：

1. `userText`：用户原始需求。
2. `attachments`：用户附图、参考图、本地图片路径或来自项目的素材引用。
3. `currentDocument`：当前 Photoshop 文档信息，可为空。
4. `projectContext`：项目路径、素材列表、模板列表、历史任务摘要。
5. `existingEvidence`：已有 `designAgentOs` evidence 数组。
6. `knowledgeResults`：来自 `DesignKnowledgeSearchService` 的只读知识结果。
7. `constraints`：尺寸、平台、禁忌词、保存/导出要求、用户显式约束。
8. `executionMode`：`plan-only`、`dry-run`、`execute-with-acceptance`。

## 6. Planner 输出

MVP 输出结构建议命名为 `DesignPlannerOutput`。

字段：

1. `intent: UserIntent`
2. `brief: DesignBrief`
3. `selectedContext`：本轮真正使用的素材、知识、视觉证据引用。
4. `designDsl?: DesignDSL`
5. `executionPlan: ExecutionPlan`
6. `verificationPlan: VerificationReport`
7. `readiness`：`ready`、`needs_context`、`blocked`。
8. `blockers`：无法执行的硬阻塞。
9. `warnings`：可执行但需复核的问题。
10. `limits`：明确不能外推的边界。

## 7. Planner 生命周期

### 7.1 Normalize Intent

目标：把用户原文转成 `UserIntent`，并保留动作优先级。

关键规则：

1. “保存详情页 PSD”优先识别为保存，不因“详情页”触发详情页生成。
2. “你是什么模型”是聊天/解释，不触发 Photoshop。
3. “帮我做一张 SKU”是设计任务，需要读取项目、文档和素材。
4. 置信度不足时输出 `needs_context`，不要强行执行。

### 7.2 Build Brief

目标：把 `UserIntent` 扩展为 `DesignBrief`。

必须包含：

1. 任务目标。
2. 输出物类型和尺寸，如未知则标记 unknown。
3. 目标人群和风格方向，如缺失则为空，不编造。
4. 用户显式约束。
5. 缺失信息列表。

### 7.3 Gather Context

目标：从现有系统收集上下文。

可用来源：

1. 当前 Photoshop 文档和图层快照。
2. 项目素材列表。
3. 用户附图或参考图解析结果。
4. `DesignKnowledgeSearchService`。
5. 文案 evidence。
6. 智能缩放 evidence。
7. 历史 `VerificationReport`。

边界：

1. 没有图片证据时，不能推断款式、材质和场景。
2. 知识搜索只作为 prompt context 或 recipe hint。
3. 当前文档信息不是目标设计完成证据。

### 7.4 Compose DSL

目标：生成最小可执行设计中间表示。

MVP 只支持低风险结构：

1. 画布尺寸。
2. 主视觉区域。
3. 文案区域。
4. 图片槽。
5. 基础对齐和安全区。
6. 必要样式 key。
7. 验收目标。

边界：

1. 没有视觉解析时，不生成具体视觉复刻 DSL。
2. 没有目标图片时，不生成图片放置执行计划。
3. 没有 Photoshop 执行后 bounds 时，不能标记视觉放置通过。

### 7.5 Build Execution Plan

目标：把 DSL 转成工具计划，而不是让模型随意调用工具。

MVP 工具计划类型：

1. `readContext`：读取文档/项目/素材。
2. `createCanvas`：创建或确认画布。
3. `placeAsset`：置入图片。
4. `transformAsset`：智能缩放/移动。
5. `createText`：创建或替换文本。
6. `applyStyleRecipe`：应用可控样式 recipe。
7. `saveOrExport`：保存或导出。
8. `verify`：读取验收证据。

每个 step 必须包含：

1. `operation`
2. `target`
3. `params`
4. `reason`
5. `expectedEvidence`
6. `risk`

### 7.6 Verify Readiness

目标：执行前判断是否能安全进入 Photoshop。

状态：

1. `ready`：已有足够上下文，且工具计划可执行。
2. `needs_context`：缺素材、尺寸、目标图、文案事实等，但可向用户/项目补充。
3. `blocked`：缺当前文档、权限、连接、API key、模型能力或工具边界。

## 8. 首个实现范围

优先顺序：

1. `plan-only` Planner：只生成 `DesignPlannerOutput`，不执行 Photoshop。
2. 参考图复刻接入：把已有 `MinimalDesignRepresentation` 映射成 planner output。
3. 主图草案接入：把用户需求、项目图片、智能缩放和基础文案组合成 planner output。
4. 再进入 `execute-with-acceptance`，由现有 executor 消费计划的一部分。

建议首个真实验证场景：参考图复刻。

原因：

1. 它最能验证“看图理解 -> DSL -> Photoshop 可编辑落地 -> QA”。
2. 已有 reference replication 模块和 smoke。
3. 能明确区分骨架、基础样式、截图级相似和人工验收。

## 9. 文件与模块建议

新增：

1. `src/shared/design-planner.ts`
2. `src/shared/design-planner.types.ts` 或直接先放在 `design-planner.ts`
3. `scripts/smoke-design-planner-mvp.cjs`

首批函数：

1. `buildDesignPlannerInputFromEvidence(...)`
2. `planDesignTask(...)`
3. `buildPlannerReadinessReport(...)`
4. `mapPlannerOutputToDesignAgentOsEvidence(...)`

不建议第一轮做：

1. 不新增数据库。
2. 不做复杂 RAG。
3. 不直接重写 executor。
4. 不在 UI 中新增复杂报告页面。

## 10. Smoke 验收

`smoke:design-planner:mvp` 应覆盖：

1. 保存类需求不会被识别为详情页生成。
2. 模型身份问题不会触发 Photoshop 执行计划。
3. 参考图复刻需求能生成 `DesignBrief + DesignDSL + ExecutionPlan`。
4. 缺少图片/素材时返回 `needs_context`，不伪造素材。
5. 知识搜索结果只进入 `selectedContext`，不成为 Photoshop action。
6. 智能缩放 planned bounds 只进入计划，不进入验收通过。
7. 输出无乱码。

## 11. 验收标准

第一阶段完成标准：

1. 存在可测试的 planner 共享模块。
2. planner 输出结构稳定，并复用 Design Agent OS 契约。
3. smoke 证明 planner 能处理聊天/保存/设计任务的边界。
4. 参考图复刻或主图草案至少有一个路径能生成 planner output。
5. `maintenance:agent-architecture` 能识别 planner MVP 进入建设，但仍不能标记成熟架构完成。

## 12. 风险和控制

风险：Planner 变成新的大而全 executor。
控制：第一阶段只 plan，不执行 Photoshop。

风险：Planner 又变成关键词路由。
控制：输出必须带 evidence、confidence、readiness、blockers。

风险：知识搜索结果污染工具调用。
控制：`allowedUses` 只允许 context/reference/recipe hint。

风险：智能缩放被误认为解决审美。
控制：没有 post-transform bounds 和截图 QA 时只能 `needs_review`。

风险：用户误以为自动设计已完成。
控制：项目记忆和报告里持续写明：Planner MVP 是控制层，不是最终设计质量闭环。

## 13. 当前实现状态

截至 2026-05-11，本计划的第一阶段代码 MVP 已落地：

1. `src/shared/design-planner.ts` 已提供 plan-only planner 类型、`planDesignTask` 和 Design Agent OS evidence 映射。
2. `smoke:design-planner:mvp` 已覆盖保存/聊天/设计任务边界、缺上下文不编造、知识搜索 allowedUses 边界和 plan-only 验收边界。
3. `maintenance:agent-architecture` 已新增 Design Planner gate。
4. `layout-replication` 和 `main-image` 已附加只读 `designPlanner` evidence，作为代表链路的第一阶段接入。
5. `layout-replication` 已开始消费 planner preflight readiness，作为进入 Photoshop 前的安全计划闸门；它仍不改变蓝图生成和工具参数。
6. `design-planner-evidence.ts` 已成为四条业务链路的 planner evidence 共享入口。
7. `detail-page` 与 `sku-batch` 已附加只读 `designPlanner` evidence，但不消费 planner steps。
8. `layout-replication` 已输出 `designPlannerExecutionAlignment`，用于比较 planner executionPlan 与 executor evidence 的类别。

仍未完成：Planner 尚未驱动真实 Photoshop executor，不能作为自动设计完成证据。下一阶段只能让一条低风险链路开始消费 planner 的计划字段，但必须继续保留真实验收边界。
