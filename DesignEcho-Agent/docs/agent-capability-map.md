# DesignEcho Agent 能力地图

更新时间：2026-05-05

## 1. 文档定位

本文件用于把 DesignEcho 从碎片化功能列表整理成能力地图。

本文件是能力 inventory：记录能力、现有实现、验证结果、边界和缺口。顶层架构入口见 `docs/design-agent-operating-system.md`；业务能力必须挂到 Design Agent OS 的生命周期和数据契约下，而不是从能力地图直接发展成第二套执行架构。

核心结论：

DesignEcho 的目标是 Photoshop 设计 Agent。主图、SKU、详情页、参考图复刻、文案优化、抠图、局部重绘等只是业务场景或能力验证路径，不是项目能力边界。当前 FEX 合格证只是一条临时简单文字排版 benchmark，不属于工具、skill 或产品功能，后续应由中性样例替换或移除。

机器校验入口：

- `node scripts/report-agent-capability-map.cjs`
- 该命令只校验能力地图的章节、边界短语、关键脚本和规划状态是否对齐，不代表任何设计效果通过。

## 2. 能力分层

### A0-A9 与横向能力的归属

用户提供的 A0-A9 / K0-M0-S0-T0-R0-P0 架构按能力地图归类如下。本节只用于 inventory 和排期判断，顶层解释仍以 `docs/design-agent-operating-system.md` 为准。

| 外部架构角色 | 归属能力层 | 当前处理方式 |
| --- | --- | --- |
| A0 总控编排 | L0 Agent 基础设施 | 归入意图控制、生命周期、任务状态和阶段控制，不新增第二套 orchestrator 文档。 |
| A1 需求理解 | L2 设计理解能力 | 归入 DesignBrief、缺失问题和任务边界。 |
| A2 产品 / 素材理解 | L2 设计理解能力 | 归入素材理解、视觉观察和资产可用性。 |
| A3 用户 / 市场洞察 | L2 / L5 | 归入设计知识、外部产品 / 市场信息和来源记录；不叫“竞品照抄”。 |
| A4 卖点 / 文案策略 | L2 / L4 | 归入文案事实锚定和业务场景策略。 |
| A5 参考 / 视觉方向 | L2 / L5 | 归入参考图理解、Visual DNA、设计知识和 benchmark。 |
| A6 设计规划 | L3 设计执行能力 | 归入 DesignDSL、ExecutionPlan、layout plan 和 placement plan。 |
| A7 执行生产 | L1 / L3 | 归入 Photoshop 工具能力、受控执行和预览 / 落地桥接。 |
| A8 审核优化 | L3 / L5 | 归入 VerificationReport、QA、截图、人工复核和回归样本。 |
| A9 交付 / 复盘 | L0 / L5 | 归入项目记忆、交付记录、learnings 和验收样本。 |
| K0 Design Knowledge Agent | L2 / L5 | 归入 Knowledge And Recipe、DesignKnowledgeResult、VisualCaseIndex。 |
| M0 Memory / Learning Manager | L0 | 归入 Context Memory、偏好、学习记录和项目复盘。 |
| S0 Skill Registry / Skill Runner | L4 | 归入业务 skill 契约、场景入口和 readiness。 |
| T0 Tool Registry / Permission Router | L1 | 归入 PhotoshopToolSemantics、工具 schema、副作用门禁和 readback。 |
| R0 Reference Source Router | L2 / L5 | 归入 Eagle、上传参考、Brand Kit、历史案例和外部来源归一化。 |
| P0 Photoshop Execution Router | L1 / L3 | 归入 UXP/MCP bridge、沙盒执行、当前文档写入授权和工具结果记录。 |

边界：

- A0-A9 不是当前已完成的多 Agent 团队，也不是 UI 必须展示的角色名。
- 主图、详情页、SKU 是 L4 业务场景；它们不能反向定义 L0-L3 的基础设施。
- `design_agent_studio_rebuild_pack_v4` 只作为外部架构参考，不作为当前 clean-start 路线。
- UI 能力归入 `UX-001`，保持现有工作台方向，不按重建包重做主界面。

### L0：Agent 基础设施

目标：让 Agent 能理解用户需求、选择路径、调用模型和工具、展示过程、生成任务报告，并在失败时暴露原因。

当前状态：进行中。

当前可定位实现：

- 意图分类与路由 smoke
- `executionSummary`
- `runtime-capability-reference-resolution/v0`：对 Knowledge / Skill / Tool / Memory / Evaluation / Policy 六类 manifest 引用核验真实 provider，缺失与类型错配保持 partial
- 最大迭代与空转保护
- 结构化 `onStep` 事件
- ChatPanel 任务报告与 Pondering 展示
- Debug Bridge 脱敏摘要

边界：

- 这层不等于设计能力完成。
- 这层只保证任务不会被伪完成、伪思考或错误路由继续掩盖。
- provider identity 可追溯不等于能力内容已加载、运行或通过；主图 /详情页 /SKU 的 Evaluation Profile provider 已注册，但真实 Provider + Photoshop 设计效果仍未通过 E2E 证明。

下一步：

- 全局步骤可观测覆盖普通聊天、确定性 skill、自主工具链和失败 Photoshop 任务。
- provider token streaming 分 provider 适配，不假装所有模型都支持。

### L1：Photoshop 操作能力

目标：让 Agent 可靠使用 Photoshop 的真实对象模型和工具，而不是只会调用一个模糊工具名。

能力范围：

- 文档：创建、切换、保存、导出、关闭。
- 图层：读取、选择、移动、分组、重命名、可见性、锁定状态。
- 文本：创建、内容、字体、字号、字距、行距、颜色、对齐、换行、段落框。
- 图片：置入、替换、缩放、裁切、主体保护、bounds 验收。
- 形状：矩形、圆形、路径、圆角、填充、描边。
- 样式：描边、阴影、渐变、发光、模糊、混合模式。
- 选区和蒙版：后续支撑抠图、局部重绘和形态处理。

当前状态：文本工具优先，其他能力分散存在，仍需统一语义。

现有工具与验收：

- `PhotoshopToolSemantics` 文本 catalog
- 文本工具 benchmark
- 字体解析工具
- 创建文本、设置文本、移动图层、保存关闭等 acceptance 断言
- 部分 live smoke

边界：

- 字段级验收通过不等于视觉质量通过。
- bounds 通过不等于排版审美通过。
- 图片 bounds 通过不等于主体裁切合理。

下一步：

- 扩展移动、对齐、图片放置、形状、样式语义。
- 把工具能力和真实 Photoshop readback 绑定。

### L2：设计理解能力

目标：让 Agent 能理解用户想做什么、参考图里有什么、元素之间是什么关系，以及设计目标是什么。

能力范围：

- 用户意图理解：聊天、解释、执行、保存、修改、复刻、设计、调试。
- 视觉理解：画布、主视觉、文字区、图片区、Logo、CTA、留白、对齐、视觉层级。
- 文案理解：标题、副标题、卖点、参数、标签、促销、合规说明。
- 版式理解：网格、列、行、基线、间距、重心、层级。
- 风格理解：颜色、材质、光影、圆角、描边、阴影、品牌调性。

当前状态：局部能力存在，但尚未形成完整设计理解体系。

现有理解模块：

- 参考图解析 DSL
- 领域定义入口
- Grid DSL 初版
- 文本排版结构分析
- 模型桶：逻辑、文案、视觉

边界：

- 模型看懂图片不等于 Photoshop 可执行。
- 领域定义不是完整知识库。
- Grid DSL 只是约束表达，不会自动提升排版质量。

下一步：

- 建立统一设计 DSL / blueprint。
- 让参考图解析、网格、文案角色和工具语义进入同一条执行链。

### L3：设计执行能力

目标：把设计理解转换为可编辑 Photoshop 结果，并在执行后检查偏差。

能力范围：

- 生成文档结构。
- 创建可编辑文本、形状、图片和分组。
- 应用 style recipe。
- 执行智能缩放和落位。
- 读取真实 Photoshop 状态做 QA。
- 生成用户可读任务报告。

当前状态：参考图复刻和部分业务 skill 已有骨架，但执行质量和闭环仍不完整。

现有执行与质量检查：

- `layout-replication` executor
- blueprint / apply / match / QA 模块
- bounds QA
- 最终视觉 Judge 的版本 / 目标窗口：只消费最后成功画布修改后、同一最终活动文档的完整像素观察；region、跨文档和旧图不取得全局审美评价信用
- `design-evaluation-profile/v0`：主图、详情页、SKU 通过 manifest 选择不同断言、必需检查项与阈值，统一回到 DesignScorecard 与 DesignVerdict
- `runtime-design-brief-declaration/v0`：三个业务 manifest 共用模型声明的 R1 Brief；Harness 直接校验 required / optional inputs，ready 前仅允许只读观察 /知识检索并阻断状态变更
- R1 → R3 → R4：Brief ready 后开放策略声明，策略 ready 后开放行动计划；Brief 重申使旧策略 /计划失效，普通 Tool batch 不再伪造输入已检查
- Skill consumer context：Harness 在执行边界生成 digest，并把 Brief declaration / digest / manifest required inputs 传给主图、详情页和 SKU Skill；业务 executor 不重复实现 Brief 治理
- `project-product-understanding/v1`：只整理素材角色和已有视觉观察，供 Planner /项目分析 /SKU 使用；不读任务文本、不推断品类、不生成买家问题、卖点策略或设计方向
- `design-evaluation-result-adapter/v0`：把对应 Skill bridge 的版本化主图 QA、详情页覆盖 /落位 /内容、SKU 覆盖 /真值 /读回 /一致性结果映射为 Profile 检查记录，并校验后写失效
- `detail-page-content-verification/v0`：Project State 商品事实 /视觉卖点观察签发稳定 refs，沿 screen plan 与实际 fill plan 前向传递，逐屏核验执行、写入和严格文本锚定
- `human-review-subject/v0` + `sku-human-review-target/v0`：用匿名项目指纹与每个 SKU 导出文件内容 hash 定义可复核批次；缺 hash 时 fail closed
- `sku-human-review-binding/v0`：从现有 Human Review Memory 恢复同 subject 记录，区分 fresh / stale / invalid，并把 fresh approved 作为 Profile 的人工复核输入
- `design-project-fact/v0`：把商品事实 /卖点从字符串提升为稳定 ID、来源、确认 /驳回 /取代、复核审计和 integrity 记录；Agent / MCP 只能写候选
- `design_project_fact_review` 卡：用户逐条确认事实，提交前核验项目与事实集合 freshness；旧字符串统一视为 legacy unattributed / unverified
- `design-project-rule/v0`：把项目 /品牌规则提升为带规则类型、适用范围、强制等级、来源、确认、取代 /撤销和 integrity 的版本化记录；Agent / MCP 只能写候选
- `design-project-rule-policy/v0`：区分 guidance / quality gate / approval required，显式报告待确认与 constraintKey 冲突，并固定声明不授予 Tool 权限
- `design_project_rule_review` 卡：用户确定性确认 /驳回规则，提交前核验项目与规则集合 freshness；旧 brandStyle 和 Design Memory project_rule 仍只是未确认来源
- `design-knowledge-governance/v0`：为 bundled、Memory、Eagle、网页和实时搜索知识绑定正文 fingerprint、source revision、provenance、lifecycle、retrieved / expiry 与 integrity
- `design-knowledge-usage-snapshot/v0`：记录本轮实际使用的知识 binding 与 current / stale / withdrawn / superseded / invalid / legacy 状态，只保留 digest，不复制正文或敏感来源
- Planner /回复上下文：只有 current 且允许 prompt_context 的知识进入决策；旧无版本和过期知识待复核，撤回 /取代 /篡改知识阻断
- 方法论 Tool：主图、详情页和通用设计原则返回与动态搜索一致的 Knowledge governance / usage snapshot，不因内置而绕过版本治理
- overlay / screenshot 显式验收入口
- 临时简单文字排版工具级 live smoke

边界：

- 当前仍偏骨架生成，不等于高保真设计。
- 当前仍是单策略执行；差异化候选、匿名成对比较、选择绑定和偏好 posterior 尚未形成生产闭环。
- executor 仍偏重，需要继续收缩为编排层。
- 真实 Agent UI + 真实模型 + 真实 Photoshop 的端到端设计质量仍缺样本。
- 旧 `ecommerce-product-design-brief/v0` 已从 active source 删除；任务 Brief 与 Product Understanding 已分离。真实 Provider + Photoshop 三 Skill E2E 仍是能力完成前的必要验收。

下一步：

- 完成真实端到端 reference replication 任务报告验证。
- 扩展非纯文本设计样例。
- 把截图级 QA 和 style recipe 接入闭环。
- 用真实桌面窗口 + Photoshop SKU 输出验证专用复核卡、应用重启后的同批次恢复和文件变化后的 stale 失效；当前只有纯逻辑测试与构建结果。
- 用真实模型验证 upsertFacts 来源 ref 质量，并在桌面窗口验证事实复核卡、项目重载与卡片过期；当前契约 /纯逻辑已接入，但未做真实 UI E2E。
- 用真实模型验证 upsertRules 的 source / applicability / constraintKey 质量，并在桌面窗口验证规则复核、冲突、撤销和交付审批提示；当前纯逻辑、State、Tool 与 UI 接线已完成，但未做真实 UI E2E。
- 用真实搜索 provider 与跨轮任务验证知识过期、重新检索、source revision 变化和撤回传播；当前本地 /注入外部结果、Planner、回复与方法论 Tool 已接入，但没有真实 provider 长时间 freshness E2E。
- 用真实模型 + Photoshop 样本验证 Profile / adapter /单一 DesignVerdict 全链，缺少必需检查结果时继续保持 insufficient。

### L4：业务场景能力

目标：把通用 Agent 和 Photoshop 设计能力应用到具体工作场景。

当前状态：进行中，已存在多条业务场景入口，但仍需回接到通用能力层。

当前业务场景：

- 主图
- SKU
- 详情页
- 参考图复刻
- 文案优化
- 抠图
- 局部重绘
- 文档管理

边界：

- 业务场景不能各自硬编码一套孤岛逻辑。
- 新业务场景必须复用 L0 到 L3 的通用能力。
- 业务场景只定义任务目标、默认约束和验收口径，不应该定义底层 Photoshop 工具真相源。

下一步：

- 对每个业务场景建立“依赖能力清单”。
- 删除或下沉不应该作为 skill 的 operation wrapper。

### L5：Benchmark 与验收样本

目标：提供可重复验证的样本，防止主观判断和夸大能力。

当前状态：进行中，已有 synthetic seed 和中性文字样例，但真实商业样本与人工评分仍不足。

当前样本：

- `rr-001-fex-certificate-text-layout`：临时简单文字排版 benchmark。
- `rr-002-neutral-quality-card-text-layout`：中性文字排版替换种子。
- `rr-003-synthetic-poster-layout`：合成海报版式种子。
- `rr-004-synthetic-ecommerce-detail-hero`：合成详情页首屏种子。
- `rr-005-synthetic-main-image-layout`：合成主图版式种子。

边界：

- FEX 只是临时简单文字排版 benchmark，不是工具、skill 或产品功能。
- 该临时 case 只验证文本排版、图层落位和参考图复刻链路。
- 该临时 case 不是工具、不是产品功能、不是完整设计能力。
- benchmark 结果不能直接外推到主图、详情页、SKU 或品牌设计。
- synthetic seed 只证明输入覆盖开始，不证明真实商业设计质量或高保真 Photoshop 执行结果。

下一步：

- 用真实参考图替换或补充 synthetic seed。
- 增加 SKU 样例。
- 每个样例都要有输入、期望、执行结果、失败点和人工评分。

## 3. 当前优先级

1. 先完成 L0：Agent 基础设施和可观测链路。
2. 同步补 L1：Photoshop 高频工具语义，文本优先，但不能只停留在文本。
3. 用 L2/L3 打通参考图复刻作为验证路径，但不把它当成唯一主线。
4. 将主图、SKU、详情页作为 L4 业务场景逐步回接到通用能力层。
5. 用 L5 benchmark 校验每次改动，不把 benchmark 当功能。

## 4. 判断新需求归属的规则

1. 如果需求是“用户要完成什么工作”，归入业务场景。
2. 如果需求是“Photoshop 要执行什么动作”，归入 Photoshop 操作能力或 MCP/tool。
3. 如果需求是“Agent 怎么判断、计划、选择路径”，归入 Agent 基础设施。
4. 如果需求是“怎么更像、更美、更符合设计规则”，归入设计理解、设计 DSL、recipe 或知识层。
5. 如果需求只是用于验证效果，归入 benchmark。
6. 如果某个能力只为一个 case 写死，应先停下来，判断是否应该抽成通用能力。

## 5. 不做的事

1. 不把临时文字排版 benchmark 写成产品能力。
2. 不把主图、SKU、详情页写成项目边界。
3. 不让每个业务场景各自维护一套硬编码 Photoshop 逻辑。
4. 不把模型输出的计划当作 Photoshop 已执行结果。
5. 不把 bounds-only QA 写成视觉审美质量通过。

## 6. 主图 /详情页 / SKU 实机 E2E 覆盖度（2026-07-12）

统一机器契约：`business-skill-live-e2e-readiness/v1`。只读入口：`npm run maintenance:business-skills-live-e2e:preflight`。

| Skill | 现有真实覆盖 | 尚缺验证 | 当前判定 |
| --- | --- | --- | --- |
| `main-image-design` | Photoshop 工具链、一次性文档、写后读回、QA 报告 | 真实 Agent / Provider、manifest stage plan、被选 Skill bridge、R4 交付检查 | `partial_runner` |
| `detail-page-design` | 真实 Agent / Provider、原子工具链、一次性文档、读回与 required signals | manifest stage plan、被选 Skill bridge、R4 交付检查 | `partial_runner` |
| `sku-batch` | Photoshop 专项执行、一次性输出、导出读回、复核报告 | 真实 Agent / Provider、manifest stage plan、被选 Skill bridge、R4 交付检查 | `partial_runner` |

环境检查：Ollama 可达；DesignEcho / UXP / MCP Bridge 的 8765–8768 均未监听。以上只是代码现状与只读基础设施检查结果，不是已完成的 Photoshop E2E，也不是设计质量通过。

离线生产拓扑已通过 `npm run smoke:agent:business-skill-system-path` 验证：三个 Skill 均复用生产 Agent、结构化 Skill→Manifest Resolver、Capability Session、R1 / R3 / R4 和 workflow bridge，并且只调用当前被选 Skill。该验证使用 fixture 模型与 fixture executor，DesignVerdict 保持未通过，只证明控制流，不改变上表 `partial_runner` 的实机判定。

### 阶段能力可见性

三类 Skill 不再在第一次模型调用中暴露全部执行能力。R1 / R3 统一使用 10 个跨品类只读上下文 Capability，经 bridge 各选择一个首选 Tool provider：用户确认、任务声明、项目资源读取 /搜索、设计知识、Eagle 参考、项目 Memory、文档摘要、视觉快照和图层结构。

生产 system-path 实测：

| 阶段 | 主图 | 详情页 | SKU | 边界 |
| --- | ---: | ---: | ---: | --- |
| R1 初始模型面 | 12 | 12 | 12 | 无业务 Skill、Photoshop 写、保存导出 |
| R3 最大模型面 | 13 | 13 | 13 | 增加当前声明控制，不增加执行工具 |
| R4 ready 后执行面 | 48 | 54 | 48 | 恢复当前 Manifest 完整执行能力 |

真实本地 7B Provider 在治理前 46 schema 下首轮超时；治理后 12 schema 能返回 Tool Call，但结构化声明仍不稳定。该结果只用于验证 Harness 负载与修复纪律，不把提高模型能力列为治理方案。
