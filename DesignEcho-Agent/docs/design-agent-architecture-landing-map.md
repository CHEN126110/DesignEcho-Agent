# 架构优化方案 × 现有代码落地映射

> 对照文档：`docs/design-agent-architecture-optimization-v1.md`（优化方案 V1.0）与 `docs/design-agent-blueprint-a0-a9.md`（A0–A9 权威概念蓝图）。
> 本文回答一个问题：方案里的每一件事，仓库现状是"已建成 / 部分建成 / 真没有"，落地时改哪里。
> 全部映射均实读代码核实（file:line，基于 commit 22c20bba 工作区）；行号随代码演进会漂移，符号名为准。
> 路径未注明者均相对 `DesignEcho-Agent/`。

---

## 一、已建成、可直接复用

### 1.1 A0 接单与分流 ↔ 意图控制面 + 既有三通道路径

**分流决策器已存在**：`src/shared/agent-intent-control-plane.ts`

- 请求类型枚举即方案 A0 的分流产出：`AgentIntentRequestKind = 'chat_only' | 'plan_only' | 'clarify' | 'uxp_user_tool_only' | 'read_only_inspect' | 'execute_skill' | 'autonomous_execution'`（agent-intent-control-plane.ts:16-23）
- 决策结构含工具权限域与执行授权三态（`toolScope`、`executionAuthorization: 'none'|'candidate_only'|'confirmed_tool_required'`，:25-56），比方案 A0 的"工作流计划"多了权限维度
- 信息缺口→追问：SKU 领域词命中但无执行授权时返回 `clarify`（:809-815），对应方案 A0 的"缺失清单"机制（单点雏形，非通用缺口清单）
- v3 拓扑默认路线：兜底签发 `autonomous_execution` 且带 `v3_default_autonomous_topology` 信号（:516-525）——**这是 CLAUDE.md 钉死的原则：本地规则只作提示，不拦截模型**

**方案 3.1 三通道对应现状**：

| 方案通道 | 现有路径 | 核实位置 |
|---|---|---|
| 全新设计 | `autonomous_execution` → 自主 ReAct 循环（受控业务技能命中+明确授权也抬升进自主循环，不套固定流水线） | agent-intent-control-plane.ts:817-831；执行器 `src/renderer/services/skill-executors/autonomous-agent.executor.ts`（1477 行） |
| 迭代修改（改文案/换素材） | `find-edit-element` 执行器（locate/setText/move/scale…动作集，find-edit-element.executor.ts:6-12）+ `replaceLayerContent` 原子工具（tool-schemas.ts:733） | `src/renderer/services/skill-executors/find-edit-element.executor.ts` |
| 批量套版 | SKU 批量：`sku-batch.executor.ts`（文件头即"规则驱动的 SKU 颜色组合生成 + 批量排版导出"，:3，共 5239 行；导出读回门禁 :5129）。详情页模板：`detail-page.executor.ts`（1233 行，`parseDetailPageTemplate` 解析屏结构→按屏填充，:465-559） | `src/renderer/services/skill-executors/` |

结论：A0 的"分流三通道"**不需要新建路由**，三条通道的执行端都在。注意红线：CLAUDE.md 已把控制面正则分类器标记为待收敛债务（仅提示不闸门），落地 A0 时应把"通道选择"交给模型声明 + 数据层任务类型（`src/shared/design-task-types.ts`），不要再扩张控制面正则。

### 1.2 Design Project State ↔ v0 契约 + 双层"单一写入者"

- 契约：`src/shared/types/design-project-state.types.ts`（`DESIGN_PROJECT_STATE_SCHEMA_VERSION = 'design-project-state/v0'`，:15；状态体 :57-93）。**实际为蓝图 17 字段 + 3 个超集字段**（`painPoints`/`competitorNotes`/`versionHistory`），共 20 个业务字段——文件头自述"蓝图 17 字段"是按蓝图基础字段列表说的，代码已超集
- 纯逻辑合并/封顶/摘要：`src/shared/design-project-state.ts`（`createEmptyDesignProjectState`:20、`normalizeDesignProjectState`:25、`applyDesignProjectStatePatch`:51、`buildDesignProjectStateSummary`:120）
- 持久化：`src/main/ipc-handlers/design-state-handlers.ts`（:1-7 注明 `<projectPath>/.designecho/design-state.json`，UTF-8 无 BOM，IO 与逻辑分层）
- Patch 保护区：`set` 不允许触碰 `schemaVersion/learnings/versionHistory`（design-project-state.types.ts:96-105），追加走专用字段——方案 2.3"A0 只合并不改业务字段"的既有雏形

**单一写入者已有两层实现，比线索给的更完整**：

1. 运行中写穿映射（v3 团队线）：`src/renderer/services/design-teams/state-sync.ts` `buildStatePatchForTeammateOutput`（:127-198）——`design_plan`→`layoutPlan`（:133）、`market_research`→`painPoints/competitorNotes`（:144）、`copy_strategy`→`sellingPoints/copywriting`（:156）、`review_report`→`reviewResult` 含裁决解析（:168）、`execution_report`→追加版本（:185）；每条 patch 带 `updatedBy = 'design-team:<role>:<stage>'`（:131）
2. **字段级所有权表（v5，方案 2.3 的完整形态已写成契约）**：`src/shared/agent-runtime-v5/owner-scopes.ts` `PROJECT_STATE_OWNER_SCOPES`（:9-19）——R0 管 workflow/project、R1 管 brief、R2 管 product_analysis/user_insights、R3 管 selling_points/copywriting/visual_direction、R4 管 layout_plan、E1 管 preview_versions、R5 管 review、E2 管 delivery/learnings。`isPathOwnedBy`（:27）判定可写性。**注意：`isPathOwnedBy` 在 src 内没有任何调用方——所有权表是建成的契约，执行点强制尚未接线**

### 1.3 逻辑 Agent ↔ design-teams 六角色（不是四角色）+ 流水线退回修订

**核实修正**：`src/renderer/services/design-teams/registry.ts` 现为**六角色**，`DesignTeammateRole` 联合类型为证（`src/shared/types/design-team.types.ts:1-7`）：

| 队友角色 | registry 位置 | ≈ 蓝图 Agent | 写权限 |
|---|---|---|---|
| scene-analyst | registry.ts:9-37（只读工具白名单 :20-33） | A2 素材/画面理解 | canWriteToPhotoshop: false（:36） |
| market-researcher | registry.ts:38-62 | **A3 用户/市场洞察** | false（:61） |
| copywriter | registry.ts:63-88 | **A4 卖点/文案** | false（:87） |
| design-strategist | registry.ts:89-118 | A5/A6 方向+规划 | false（:117） |
| executor | registry.ts:119-161 | A7 执行桥 | **true**（:160） |
| critic | registry.ts:162-198 | A8 软审 | false（:198） |

流水线：`coordinator.runPipeline`（`src/renderer/services/design-teams/coordinator.ts:259`）为**六阶段**：analyze（:332）→ market（:345）→ copy（:357）→ plan（:369）→ execute（:381）→ review+修订循环（:394-447）。已覆盖蓝图 A2→A3→A4→A6→A7→A8 主干。

- 修订轮上限：`maxRevisions = Math.max(0, Math.min(2, request.maxRevisions ?? 1))`（coordinator.ts:276）——**默认 1 轮、硬上限 2 轮**
- 按问题类型退回（方案 3.3 保留项的现实实现）：`pickPrimaryIssueOwner(verdict)` → `buildRevisionRoute(owner)` 按 issue owner 路由到对应角色再修（coordinator.ts:423-435）
- critic 裁决与确定性评分卡并轨：`buildDeterministicScorecard` + `mergeDeterministicScorecardIntoCriticVerdict`（coordinator.ts:406-409；合并逻辑在 `src/shared/design-team-verdict.ts:143-164`），带测量新鲜度门禁（结构读必须晚于最后一次成功写，coordinator.ts:401-405 注释）
- A2‖A3 并行（方案 3.2 第 3 步）：`delegateToAgent` 对只读队友可并发，`PARALLEL_SAFE_TEAMMATE_ROLES` 含 scene-analyst/market-researcher/copywriter/design-strategist/critic（`src/shared/agent-parallel-execution-policy.ts:22-28`，单批上限 3，:31），与 registry 的 `canWriteToPhotoshop` 由 smoke 交叉校验（:18-21 注释）

### 1.4 A7 渲染引擎雏形 ↔ 声明式布局引擎 + renderLayout

- **求解器**：`src/shared/layout/layout-engine.ts` `solveLayout(spec)`（:99-178）——输入 `LayoutBlock { role, heightRatio, widthRatio, hAlign, content }`（:26-40），输出 `ResolvedBlock { x, y, width, height, z }`（:52-61）；比例超界整体压缩+警告（:140-143）、越界安全网（:170-174）
- **z 序是确定性设计规则**：`ROLE_Z`（:80-88，背景 0→主图 10→副标题 18→标题 20→卖点 22→标签 28→装饰 30），且**刻意不让模型碰 z**（:37-39 注释）——正是方案 4.1"程序化可控"的第一性实现
- **工具暴露**：schema `renderLayout`（`src/renderer/services/agent-runtime/tool-schemas.ts:634`，描述明确"阶段草稿，不代表最终整张图"）；实现在 `src/renderer/services/tool-executor.service.ts:1867-2109`（动态 import solveLayout :1868、求解 :1986、role 白名单校验 :1899-1908、旧阶段草稿替换 :1947-1979、详情页 stagePlan 强制 :1887）
- engine 侧对 renderLayout 的公开计划约束成体系（`src/renderer/services/design-agent/engine.ts:2281-2340`：画布尺寸一致、blocks 非空、content 必须是买家可见文案、placeImage 需 belowText 防遮挡）

**这就是"版式 JSON→渲染"的现有中间表示（v1：role+ratio 声明式）**。方案 4.1 的绝对 rect/z 版本见第三节——但注意 v5 契约层已有同构 schema（见 3.1），不要起第三套。

### 1.5 A8 审核双层 ↔ 测量→断言→评分卡→单一裁决口径

**硬规则层（代码、确定性、0 token）**：

- 测量提取：`src/shared/design-quality-measurement.ts` `extractDesignQualityMeasurements`（:210，输入 `DesignSurfaceSnapshot` :50）
- 确定性断言：`src/shared/design-quality-assertion.ts` `DESIGN_ASSERTIONS`（:115）共 **14 条断言、8 维度**——其中 7 条 `deterministic`（comp.subject-ratio :118、comp.alignment :129、color.contrast :140、color.background-designed :151、hier.type-scale :162、craft.precision :173、overall.above-baseline :184），执行器 `evaluateDeterministicAssertions`（:375）
- 工具级验收：`src/shared/acceptance/tool-acceptance.ts`（`shouldCollectAcceptanceEvidence`:217、`buildToolAcceptanceEvidence`:260、断言结构 `ToolAcceptanceAssertion`:65）——写操作后的读回证据层

**软判断层（视觉模型，看真实成品图）**：

- VLM 判官 7 条断言（method: 'vlm_judge'：impact.squint :197、sell.visualized :208、comp.focal-balance :219、color.scheme :230、hier.three-level :241、type.character :252、craft.depth :263）——正是方案 4.3"必须看渲染后成品图"的主观维度
- 批量一次调：`agent.ts` 取 `getVlmJudgeAssertions()` → `buildVlmJudgeSystemPrompt` 固定评审标准与 JSON 协议，`buildVlmJudgeContextMessage` 把任务 / Brief / Strategy 封入独立 user 级不可信数据 envelope，再与成品截图一起交给视觉模型 → `parseVlmJudgeResponse`；前置保持三重诚实门禁：无成品截图不打分、无新鲜结构读不空调、无视觉模型不伪造。
- Profile 验证记录按 check 声明 `allowedSources`，伪造 source / status 不取得完成信用，重复状态按最严格结果合并；局部编辑若出现文字、样式、几何、图层增删或影响呈现的结构变化，缺少同版本 visual Judge 会动态转 `fresh_visual_evaluation=needs_review`，而纯重命名等非视觉结构操作不被强制走视觉流程。
- critic 团队软审见 1.3；两层在 `src/shared/design-quality-verdict-bundle.ts` `buildDesignVerdict`（:109）收口为**唯一裁决口径**（:11 注释），blocker 硬（进 blockers 触发返工）/major 软（仅 warnings）——接进主循环 executionSummary 见 agent.ts:3662-3695（:3686-3688）

**结构化修改指令（方案 4.3 输出格式）**：

- 断言失败 → `toDesignCriticIssues(scorecard)` 转带 owner 的结构化 issue（design-quality-assertion.ts:788；被 design-team-verdict.ts:15,164 消费）
- v5 `ReflexionHandoff` 契约（`src/shared/agent-runtime-v5/reflexion-contract.ts:161`；`buildReflexionHandoffFromReviewReport`:305、ReAct 循环契约 `buildReActReflexionLoopContract`:232）——与方案的 `{verdict, round, edits[]}` 同族，差"指向 layer_id 的定点 edit 粒度"（依赖版式 JSON，见第三节）

### 1.6 人工确认点 ↔ 交互卡片原语 + 公开计划审批链（两套并存）

- 交互卡片 v0 契约：`src/shared/interactive-card-contract.ts`（`'interactive-card/v0'`:3、`InteractiveCardDefinition`:32、提交/校验/记忆策略 :44-52）
- 既有卡片种类（kind）：`sku_combo_editor`（`src/shared/sku-combo-interactive-card.ts:289`，SKU 组合确认卡，单一来源生成）、`editable_confirmation`（`src/shared/editable-confirmation-interactive-card.ts:283`，**字段类型含 'choice' 单选**，:15-19——确认②三选一可直接用它拼装）、v5 `visual-observation.blocked` / `structure-only.skeleton`（`src/shared/agent-runtime-v5/visual-observation-card.ts`）
- **核实澄清**：公开计划确认不走 interactive-card/v0，而是独立审批链：`src/shared/agent-task-public-plan-approval-record.ts`（审批状态机 :7-13）+ `agent-task-public-plan-controlled-runner.ts` 等系列文件。v5 侧另有审批签发策略 `src/shared/agent-runtime-v5/approval-policy.ts`（:1-10：质检未通过拒绝签发、不同 scope 独立审批）——**确认③"终稿放行"的门禁语义 v5 已写成纯函数**

### 1.7 回退轮次上限 ↔ 两个已建机制（一个已接线、一个待接线）

- **已接线**：`src/shared/reflexion-reentry-policy.ts`——`DEFAULT_MAX_REFLEXION_REENTRIES = 1`（:59）、`decideReflexionReentry`（:90，超限判定 :108，另有失败签名 `buildReflexionFailureSignature`:78 防同错重试）。执行器外层消费：autonomous-agent.executor.ts:1395（决策）与 :1417（重入任务文本注入 `buildReflexionReentryMessage`）
- **未接线（核实确认）**：`evaluateQualityLoopDecision`（design-quality-assertion.ts:715，`DEFAULT_MAX_ROUNDS = 3`:700）在 src 内**零调用方**（仅 `scripts/smoke-design-quality-assertion.cjs` 覆盖）。它的语义（继续修/停/升级、防无进展震荡）与方案 3.3"≤3 轮超限升级人工"逐字对应——**方案正好是给它接线的语义依据**，见第五节 P0
- 团队线的 ≤2 轮修订见 1.3（coordinator.ts:276）

### 1.8 金标回归文化 ↔ reference-replication 基准体系

- 基准资产：`benchmarks/reference-replication/`（cases/、cases.manifest.json、case-template.json、scorecard-template.md、intake-workflow.md）——即方案 8.2"每任务含输入、期望产出要点、历史得分"的结构
- 管线脚本：package.json 有 9 个 `benchmark:reference-replication:*`（create-case/capture-plan/capture-live/evaluate-result/record-result/validate-evidence…）+ 10 余个 `smoke:reference:*`；质量声明有 gate（`scripts/check-reference-quality-claim-gate.cjs`）
- 全仓 smoke 脚本 420 个（scripts/ 实数），分层闸门 `maintenance:validate:*`——方案 8.2"任何变更先跑回归"的文化已是现行制度

---

## 二、部分已建、需增量

### 2.1 State 字段属性（status/confidence/written_by）——v0 无、v5 契约已有原语

- v0 DPS 字段是裸值（design-project-state.types.ts:57-93），仅状态级 `updatedBy`（:92）与 patch 级 `updatedBy`（:103-104）；`copywriting` 条目有 `basis` 依据字段（:28）是唯一的字段内溯源
- **v5 契约层已有完整原语（核实补充，比线索"现无"更乐观）**：`src/shared/agent-runtime-v5/contracts/common.ts`——`EvidenceFact { status: 'confirmed'|'inferred'|'unknown', confidence: 0..1, sourceRefs }`（:71-78，即方案 2.1 的三态+置信度，措辞 inferred≈assumed）、`Assumption { confidence, requiresConfirmation }`（:101-106）、`MissingInput { severity: 'blocking'|'degradable'|'optional' }`（:92-98）、`ArtifactMeta.producer.runtimeUnit`（:45-50，= written_by）
- 增量 = 把这些原语从 v5 artifact 层下沉/映射到 DPS 字段属性（或反向：DPS 只存 ArtifactRef，按 v5 设计 :26-31）

### 2.2 依赖图脏标记——无自动传播，有溯源钩子

- 全仓无字段依赖图与 dirty 传播机制（grep 核实：shared 内 "dirty/脏标记" 仅 content-hash.ts、design-copywriting-framework.ts 的无关命中）
- 但 `ArtifactMeta.sourceRefs`（上游 artifact 引用，common.ts:43）+ `sourceRevision`（:41）+ `contentHash`（:52）已构成"上游变了可检测"的全部原料——脏标记只差一个"按 sourceRefs 反向标 stale"的纯函数，天然落 v5

### 2.3 确认② 三方向卡——无现成卡，但原语齐全

- 现有卡 kind 清单见 1.6，无"三方向选一 + 缩略图"卡
- 可组合原料：`editable_confirmation` 的 choice 字段（editable-confirmation-interactive-card.ts:18）+ v5 R3 的 `creative_strategy` 所有权（owner-scopes.ts:13）+ 渲染 UI `src/renderer/components/message/blocks/InteractiveCardBlock.tsx`。缩略图预览可复用 renderLayout 草稿（1.4）产快照

### 2.4 规范库——方法论知识有、合规数据库无

- 已有（`src/shared/knowledge/` 共 7 件）：design-principles.ts（通用视觉原理，:1-15 头注明"知识只作上下文，不硬编码进运行时分支"）、main-image-framework.ts、detail-page-framework.ts、color-schemes.ts、pain-points.ts、selling-points.ts、socks-categories.ts——覆盖方案 6.1 的"版式知识 / 行业疑虑经验库 / 参考拆解"类
- **缺（grep 核实零命中）**：禁词库（广告法+平台敏感词）、字体授权白名单——方案 4.3 两条 must 级 Lint（文案风险、字体侵权）当前**没有数据源**，deterministic 断言里也没有对应条目（1.5 的 7 条确定性断言全是几何/色彩测量）。UXP 侧 `resolveFontName` 工具只做字体名解析，不做授权判定

### 2.5 A9 归档——SKU 导出有完整闭环，通用交付包无

- SKU：批量导出+命名+读回验收（sku-batch.executor.ts:4896-5054 按规格导出组合文件、:5129 导出读回门禁）
- 复盘沉淀：流水线级 A9 复盘已接（state-sync.ts:200-236 `buildPipelineRetrospectiveStatePatch` 写 `appendLearning`，:253 注释直接自称"A9 复盘"）；`deliveryFiles` 字段存在但只有模型手工经 `updateDesignProjectState` 写入（grep：仅 types/逻辑/tool-schemas 三处）
- **缺**：蓝图 A9 的文件夹规范（01_Brief…08_Learnings）、命名规范（品牌产品平台用途尺寸版本日期）、交付说明生成——均无代码

---

## 三、真正新建

### 3.1 版式 JSON 完整 schema——**重大核实修正：v5 契约层已存在同构 schema，新建的是"渲染桥"不是 schema**

方案 4.1 的 schema 要素逐项对照 v5 契约（`src/shared/agent-runtime-v5/contracts/`）：

| 方案 4.1 要素 | v5 已有契约 | 位置 |
|---|---|---|
| 绝对 rect + z | `LayoutRegion { bounds: NormalizedRect(0..1), zIndex, role, alignment, overflow }`（规划层归一化）；`PreviewNode { boundsPx, zIndex }`（渲染层像素） | common.ts:137-167；preview-scene.ts:9-19 |
| component 组件类型 | `ElementPlan { role: 'feature_icon'|'badge'|'divider'|'callout'|…, regionId, styleTokenRefs, transform }` | common.ts:173-195 |
| 图片槽位（asset_ref/fit） | `ImageSlotPlan { assetId, placement: { fit, anchor, scale, rotation, focalPoint }, mask }` | common.ts:122-134 |
| sections[] 多屏 | `DetailPagePlan.payload.screens: DetailPageScreen[]`（每屏 copy/images/elements/layout.normalizedRegions/readingOrder） | detail-page-plan.ts:17-40 |
| canvas/safe_area | `DetailPagePlan.payload.canvas + globalRules { gridColumns, safeMarginRatio, spacingScale }` | detail-page-plan.ts:49-60 |
| meta/version | `ArtifactMeta { artifactId, sourceRefs, sourceRevision, contentHash, producer }`，不可原地改、改=新 artifactId | common.ts:34-53、:4-8 头注 |

坐标分层规则已定死（detail-page-plan.ts:3 头注）："DetailPagePlan 用归一化坐标 0..1；PreviewScene 才转像素；PhotoshopTaskPlan 用 slot 映射"。

**真正缺的（grep 核实）**：`PreviewScene` 在 src 内只有 v5 契约自身引用，**没有任何渲染器消费它**；`LayoutRegion → renderLayout(LayoutSpec)` 的降解适配器不存在；多尺寸延展规则（同一 JSON→主图/banner/详情页头图）不存在。结论：**新建项 = 渲染桥（v5 版式契约 → layout-engine/renderLayout → UXP）+ 多尺寸适配规则**，schema 以 v5 契约为 v2 权威、layout-engine 的 role/ratio 声明式作 v1 降级入口——不起第三套。

### 3.2 改稿 diff 采集——无

全仓无"人工终稿修改回读为结构化 edit"的机制。前置依赖已就位：写后读回证据（tool-acceptance.ts）、图层结构读（getLayerHierarchy）、renderLayout 的声明式规格可作 diff 基线。归因队列可复用设计学习的 review/writeback gate（`design-learning-runtime-*.service.ts`，CLAUDE.md 已载）。

### 3.3 CTR 回流——无

无任何效果数据回填通道；`DesignProjectState.learnings` 与知识库准入 gate 是未来挂载点。属外部数据依赖，代码侧只能先预留元数据字段。

### 3.4 L3 提示词自动优化——无

无优化器/回归跑分/提示词版本化流水线。金标集机制（1.8）是其前置，方案 7.3 的"金标集就绪后再上"顺序与仓库现状一致。

---

## 四、对方案的两处修正建议（重点）

### 4.1 渲染引擎选型：V1 应直接走 PS/UXP，跳过 HTML/CSS 阶段

方案 4.2 表格把"HTML/CSS + 无头浏览器"列为 V1 首选、"PS/UXP 脚本"排 V2+，理由是 HTML 路线"文字对齐可控、改版=改 JSON"。**这个排序对从零起步的团队成立，对本仓库是倒置的**——方案眼中的"V2+ 大工程量"恰恰是本仓库唯一建成资产，方案眼中的"V1 低门槛"才是从零：

**PS/UXP 路线的建成资产盘点（全部实测计数/实读核实）**：

1. **工具面**：Agent 侧工具 schema 138 个（tool-schemas.ts 顶层 name 计数）、UXP 侧工具实现 122 个（`DesignEcho-UXP/src/tools/registry.ts` 工具实例计数）——文字/图层/画布/选区/变形/调色/导出全链路。注：CLAUDE.md"约 80 个"已过时，以 `npm run audit:tools` 为准
2. **"改版=改 JSON"在 UXP 路线已经成立**：renderLayout 就是声明式 JSON→画布（1.4），且带旧阶段草稿替换语义（tool-executor.service.ts:1947-1979）——方案给 HTML 路线记的独有优点，这里已有
3. **验收断言**：写后读回+确定性断言体系（1.5），HTML 路线要全部重建
4. **设计纪律**：`src/shared/design-discipline-runtime.ts`（先读方法论→建立视觉观察→改后必看→不无限微调，:1-14）、v5 视觉观察前置条件（`visual-observation-gate.ts`，P0 红线）——均绑定 PS 工具语义
5. **混合出图原则的原料**：抠图（matte-product.executor.ts + 本地 BiRefNet/SAM ONNX）、生图接入（`.claude/skills/bfl-api`、`flux-best-practices`，CLAUDE.md 定"图像生成默认走 BFL FLUX"）——方案 4.2"产品实拍抠图 + 背景生图 + 排版引擎压字"三件在仓库都有落点
6. **交付格式**：电商交付要 PSD 源文件（蓝图 A9 明列 PSD），HTML 截图路线交付不了可编辑源文件，最终仍要补 PS 后端

**修正后的 A7 落地路线**：版式 JSON（v5 契约为权威 schema）→ 降解为 LayoutSpec/renderLayout（阶段草稿）+ 精确 rect 直控工具（moveLayer/setLayerBounds 类）→ UXP 执行 → acceptance 读回 → A8 双层审。HTML 无头浏览器如果未来要做，定位是"低成本预览渲染器"（渲染 PreviewScene 出缩略图供确认②），不是生产渲染引擎。

### 4.2 与 v5 manifest 运行时合流：方案的流程/审核/回退天然属于 v5 契约层

CLAUDE.md 架构大图明确进行中的重构方向："v3 → v5 收口：把命令式 v3 循环逐步替换为 v5 manifest 驱动的 stage plan。新写业务工作流优先落到 v5 manifest/契约，而非往 v3 执行器堆专属分支"。方案 V1 的落地面应直接对齐 v5，理由是**结构同构已经存在**：

- **A0–A9 ↔ v5 runtime stage 几乎一一对应**（owner-scopes.ts:9-19 + manifest）：R0 编排=A0、R1 brief=A1、R2 素材/洞察=A2+A3、R3 卖点/文案/视觉方向=A4+A5、R4 版式规划=A6、E1 执行=A7、R5 评审=A8、E2 交付/沉淀=A9。主图 manifest 已声明全阶段 `runtime_stages: ['R0','R1','R2','R3','R4','E1','R5','E2']`（manifests/main-image.manifest.ts:18）
- **"新增能力=新增 manifest 不改核心"**（skill-runtime.ts:1-24，注册表现有 detail-page/main-image/sku-batch 三份 manifest）——正是方案 1.2"逻辑 Agent=提示词+字段读写权限，不必是独立服务"的代码形态：manifest 的 read_scopes/write_scopes（main-image.manifest.ts:21-22）就是字段读写权限声明
- 方案的审核门禁（4.3）、人工确认（第 5 节）、回退（3.3）在 v5 已有对应契约位：`visual-observation-gate.ts`（看图先于规划）、`approval-policy.ts`（质检不过拒签审批）、`reflexion-contract.ts`（观察→批评→修订循环与 Handoff）、`runtime-stage-plan.ts`（阶段计划含"失败去向"，:1-6 头注）
- 反面教训就在仓里：详情页把流程编码进 executor 状态机（freshDetailPage*）成为最大架构违例，正被 D→B→A 治理拆除（CLAUDE.md"设计能力治理"）。**方案若按 v3 执行器方式落地，等于重演这个债务**

结论：方案第 1、3、5 节的流程定义应写成 v5 manifest + 契约扩展（新增字段属性、方向卡 stage、quality-loop 上限进 runtime_stage_plan 的失败去向），v3 循环只消费其产物；不在 engine.run()/executor 里新增流程分支。

---

## 五、落地序（P0→P3）

> 验收统一走分层闸门：改 shared 纯逻辑 → 对应 smoke + `npm run maintenance:validate:agent-fast`；改 renderer → 加 `npm run build:typecheck:renderer`（唯一权威类型闸）；提交前 `npm run maintenance:preflight`。

### P0（地基三件，互不阻塞可并行）

**P0-1 版式 JSON schema v1 + 渲染桥**
- 内容：定 v5 `LayoutRegion/DetailPageScreen` 为权威 schema；写降解适配器 `LayoutRegion(归一化 rect/z) → LayoutSpec(role/ratio)`，可放 `src/shared/layout/region-adapter.ts`（新文件，纯函数）；layout-engine 增加"绝对 rect 直通"模式（不走比例求解、保留越界安全网）
- 改动预估：`src/shared/layout/layout-engine.ts`（+直通模式）、`src/shared/layout/region-adapter.ts`（新）、`src/renderer/services/tool-executor.service.ts`（renderLayout 分支接受 regions 输入）、`src/renderer/services/agent-runtime/tool-schemas.ts`（schema 扩参）
- 验收：新增 `scripts/smoke-layout-region-render.cjs`（归一化→像素确定性、z 序不可被输入覆盖、越界警告）；`smoke:v5:runtime-contract-bundle` 不回归

**P0-2 State 字段属性（status/confidence/written_by）**
- 内容：DPS v0→v0.1，业务字段可选包裹 `{ value, status: 'missing'|'assumed'|'confirmed', confidence?, writtenBy?, updatedAt? }`，语义对齐 v5 `EvidenceFact`（common.ts:71-78）；normalize 兼容裸值旧数据（读旧写新，不迁移存量文件）
- 改动预估：`src/shared/types/design-project-state.types.ts`、`src/shared/design-project-state.ts`（normalize/merge/summary）、`src/renderer/services/design-teams/state-sync.ts`（写穿带 writtenBy，已有 updatedBy 直接下沉）、`tool-schemas.ts`（updateDesignProjectState 参数说明）
- 验收：扩 `scripts/smoke-design-project-state.cjs`（三态合并、旧格式兼容、assumed 不得静默升 confirmed）

**P0-3 接线 evaluateQualityLoopDecision（≤3 轮升级人工）**
- 内容：在 agent.ts 质量裁决处（:3662-3695 之后）维护轮次历史，消费 `evaluateQualityLoopDecision`（maxRounds=3）决定"继续修 / 停 / 升级人工"；与 reflexion 重入（≤1 次跨任务重试）收敛口径：轮内微调走 quality-loop、整任务返工走 reentry-policy，两者上限独立、都到顶即升级人工（出 `editable_confirmation` 卡）
- 改动预估：`src/renderer/services/agent-runtime/agent.ts`、`src/renderer/services/skill-executors/autonomous-agent.executor.ts`（reentry 分支 :1395-1417 处补触发条件）、`src/shared/design-quality-assertion.ts`（如需暴露历史构造器）
- 验收：扩 `scripts/smoke-design-quality-assertion.cjs` + 新增接线 smoke（断言：3 轮不过必升级、无进展提前停、升级产物含结构化 issues）

### P1（人工确认与合规数据）

**P1-4 确认② 三方向卡**
- 内容：A5/R3 产出三方向后出选择卡；优先用 `editable_confirmation` 的 choice 字段拼装（零新原语），每方向附 renderLayout 草稿快照缩略图；卡动作走确定性控制器（对齐 v5 卡片"不重入发送管线"边界）
- 改动预估：`src/shared/`（方向卡 payload 构造器，新文件或并入 editable-confirmation）、`src/renderer/components/message/blocks/InteractiveCardBlock.tsx`、ChatPanel 卡片动作接线
- 验收：新增卡片契约 smoke（选择值校验、取消语义）+ `smoke:v5:chatpanel-boundary` 不回归

**P1-5 规范库数据化（禁词库 + 字体白名单）**
- 内容：`src/shared/knowledge/banned-words.ts`（广告法+平台，带版本号与来源）、`font-whitelist.ts`（字体→授权状态）；各暴露查询工具（照 getDesignPrinciples 的登记链路：schema/执行/preflight 分类/显示名，以 `audit:tools` 收口）；deterministic 断言追加 blocker 级 `copy.banned-words`、`type.font-license`（文本层字体名从 getAllTextLayers 读回）
- 改动预估：knowledge 两个新数据文件、`design-quality-assertion.ts`（+2 断言）、`tool-schemas.ts`/`tool-executor.service.ts`/`agent-tool-execution-preflight.ts`（工具登记）
- 验收：`npm run audit:tools`、新增 `scripts/smoke-compliance-lint.cjs`（禁词命中→blocker、白名单外字体→blocker、数据文件带版本）

### P2（数据飞轮起步）

**P2-6 改稿 diff 采集 + 归因队列**
- 内容：终稿放行前对比"最后一次 Agent 声明的版式规格 vs 人工修改后的 getLayerHierarchy 读回"，产出结构化 edits 落 `<项目>/.designecho/revision-diffs/`；同类 edit ≥3 次进候选规则队列，走设计学习 review/writeback gate 人工合并
- 改动预估：`src/shared/`（diff 纯逻辑，新文件）、`src/main/ipc-handlers/`（落盘）、`design-learning-runtime-*.service.ts`（归因入队）
- 验收：diff 纯逻辑 smoke（rect/文字/删除三类 edit 提取正确、无变化零 diff）+ `smoke:design-learning:*` 不回归

**P2-7 A9 通用交付包**
- 内容：蓝图 A9 的文件夹结构（01_Brief…08_Learnings）与命名规范做成数据 + 导出编排（复用 saveDocument/exportDocument + SKU 导出读回门禁模式），交付说明由 State 摘要生成；`deliveryFiles` 由交付流程写入而非仅模型手填
- 改动预估：`src/shared/delivery-package.ts`（新，命名/清单纯逻辑）、执行编排接 E2/A9 位
- 验收：新增交付包 smoke（命名确定性、清单完整性校验、缺源文件诚实报缺）

### P3（外部信号与自动优化）

**P3-8 CTR 回流**：State/知识库条目预留效果元数据字段 + 人工录入通道（外部数据拿不到是方案 6.2 自认的边界）；验收=字段契约 smoke。
**P3-9 L3 提示词优化**：金标集扩到 30+ 后，按方案 7.3 流程做优化器提案→`benchmark:*` 跑分→人工合并；目标函数多元化防讨好 A8（方案 7.3 第 3 条）。前置：P2-6 的 diff 信号 + 1.8 基准体系扩任务面。

---

## 附：核实中发现与给定线索不符/需修正之处汇总

1. **design-teams 是六角色不是四角色**：registry.ts 已含 market-researcher（≈A3，:38）与 copywriter（≈A4，:63）；runPipeline 为六阶段（coordinator.ts:332-397）。CLAUDE.md 的"4 个队友角色"描述同样过时
2. **"版式 JSON 完整 schema 属真正新建"不成立**：v5 契约层已有同构 schema（LayoutRegion/ImageSlotPlan/ElementPlan/DetailPageScreen.screens[]/PreviewScene 像素 IR，见 3.1）；真正新建的是渲染桥与多尺寸规则
3. **"State 字段属性现无"需限定为 v0**：v5 common.ts 的 EvidenceFact/Assumption/ArtifactMeta 已提供 status/confidence/written_by 全部原语（2.1）
4. **单一写入者不止 state-sync 雏形**：v5 owner-scopes.ts 已是完整字段级所有权表，但 `isPathOwnedBy` 无调用方（契约建成、强制未接线）
5. **公开计划确认不属于 interactive-card/v0 体系**：是独立的 public-plan 审批链（1.6）
6. **团队修订默认 1 轮、上限 2 轮**（coordinator.ts:276），"≤2 轮"是上限非默认
7. **v0 State 为 20 个业务字段**（蓝图 17 + painPoints/competitorNotes/versionHistory 超集）
8. **工具规模**：Agent 侧 schema 138 个、UXP 侧 122 个（实测计数）；线索"约 140"对 Agent 侧成立，CLAUDE.md"约 80"已过时
9. renderLayout 的 schema 在 `agent-runtime/tool-schemas.ts:634`，执行实现才在 `tool-executor.service.ts:1867`（线索只给了后者，两处都需登记）
10. `evaluateQualityLoopDecision` 未接线属实（src 零调用方，仅 smoke 覆盖）——线索准确
