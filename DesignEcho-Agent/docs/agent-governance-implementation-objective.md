# Agent 治理可实施目标与内容规划

## 1. 文档定位

本文把“Agent 架构治理”和“Capability Governance”转换为可编码、可迁移、可验收的实施规划。

- 项目总目标、范围和验收口径仍以 `project-memory/Prompt.md` 为准。
- 当前正在执行的切片仍以 `project-memory/CurrentTask.md` 和 `project-memory/Plan.md` 为准。
- 顶层职责边界仍以 `docs/design-agent-operating-system.md` 为准。
- 本文是实施说明，不建立第二套架构，不覆盖上述真相源。

## 2. 修订后的项目目标

长期产品目标是一个能够承接开放式设计任务的专业设计 Agent，而不是主图、详情页、SKU 三个自动化入口的集合。用户提供目标、素材、约束或已有 Photoshop 文档后，Agent 应能使用可追溯的设计知识和可插拔 Skill 完成理解、规划、真实 Photoshop 执行、读回、评价、修订与交付；当知识、能力、授权或证据不足时，应明确请求输入或停止。

在不训练或升级基础模型、不在通用 Agent 核心中写入主图、详情页、SKU 品类流程的前提下，把当前 v3 真实执行路径与 v5 治理契约逐步收口为一条生产运行时：同一个 Agent 入口能够根据用户目标和当前证据选择 Skill、形成可调整计划、按阶段装载 Capability、调用 Tool、观察真实结果、执行 Policy、完成 Evaluation，并在失败时修订计划或停止。

`main-image-design`、`detail-page-design`、`sku-batch` 是第一批验收 Skill，不是三套 Agent，也不定义 Agent 的最终设计边界。新增第四个设计 Skill 时，原则上只新增 Skill 包、Knowledge 引用及其专业 Capability，不修改通用 Planner、Agent 循环或执行安全边界。

完成不以“已有 Prompt、Manifest、契约或 Smoke”为判断依据，而以三类 Skill 都从同一生产入口完成真实 Provider + 一次性 Photoshop 文档的任务理解、证据读取、策略、计划、执行、读回、评价和交付闭环为依据。

## 3. 抽象概念对应的可实现对象

| 概念 | 代码中的责任 | 必须形成的对象 | 不应承担的责任 |
|---|---|---|---|
| Agent | 面向用户完成目标的整体系统 | `Model + Harness` 的单一生产入口、统一运行结果 | 不是一个万能 Prompt，也不是品类路由器 |
| Model | 理解、判断、策略、计划、修订 | `DesignBrief`、`DesignStrategy`、`ActionPlan` 的模型声明 | 不直接授予权限，不伪造执行或质量证据 |
| Harness | 稳定运行与约束 | Stage State、Capability Session、Context、Scheduler、Policy、Trace、Evaluation、Stop Condition | 不代写设计内容，不内置详情页/主图/SKU 方法论 |
| Planner | 根据目标和证据决定路径 | 可重申的 R4 任务图、依赖、预期证据、失败策略 | 不输出固定 Photoshop 调用清单 |
| DAG Runtime | 执行已声明的依赖关系 | ready-node 计算、只读并行、写入串行、节点状态、重试/回退事件 | 不替代模型选择 Skill 和设计判断 |
| Capability | 可发现、可装载的能力身份 | Catalog、Provider Binding、Session、Stage Visibility、Availability | 不因“可用”而自动执行，也不等于质量通过 |
| Skill | 可插拔专业解决能力 | Manifest、输入契约、方法论引用、阶段约束、输出契约、评价 Profile | 不写进 Agent 核心，不等同一个 Tool |
| Knowledge | 当前可追溯的事实、规则、方法论 | Version Binding、Freshness、Usage Snapshot、来源 | 不授予执行权限，不长期塞进系统 Prompt |
| Tool | 对外部世界执行单一动作 | Schema、Side Effect、Preflight、Result Evidence、Readback | 不定义专业工作流，不自行宣布任务完成 |
| Memory | 跨轮保存经治理的状态和偏好 | Project State、用户确认、版本与来源、失效规则 | 不覆盖当前用户指令，不把推断永久固化 |
| Evaluation | 根据证据判断目标和质量 | Profile、Evidence Adapter、Scorecard、唯一 DesignVerdict | 不把 Tool success 当设计通过 |
| Policy | 在执行点约束行为 | 权限、审批、品牌规则、安全、写入/发布边界 | 不用关键词提前剥夺模型思考与规划空间 |

## 4. “动态规划”的工程定义

动态规划不是“模型可以任意调用所有工具”，也不是“每类任务都有一份可修改模板”。它必须满足：

1. Model 根据当前用户目标、Manifest 输入、真实 Evidence 和已装载 Capability 声明计划。
2. Harness 只校验结构、依赖闭环、Capability 存在性、Evidence 引用、Policy 和副作用边界。
3. 简单任务允许单节点计划；复杂任务才展开为 DAG。
4. 只读且互不依赖的节点可以并行；Photoshop 写入、状态写入、保存与交付必须串行。
5. Tool 结果进入 Observation，节点状态只能由真实 Evidence 推进。
6. 失败后由 Model 选择重试、换能力、修改计划、请求输入或停止；Harness 执行有界次数和停止条件。
7. R4 当前影子计划只有在真实 Provider 行为、节点对账、freshness 和 no-redo 误判率达到退出条件后，才能升级为现有运行时中的可执行调度；不得新建第三套 DAG Runtime。

## 5. Skill 的最低可交付结构

每个正式 Skill 至少包含以下内容：

```text
Skill Package
├── manifest                 # 稳定 id、适用任务、输入输出、阶段、能力引用
├── intake schema            # 必需/可选输入及缺失处理
├── methodology refs         # 有版本的 Knowledge 引用
├── capability refs          # 所需 Skill/Tool/Memory/Evaluation/Policy provider
├── planning constraints     # 可调整的阶段约束，不是固定 Tool 顺序
├── output contracts         # 结构化交付物和执行证据
├── evaluation profile       # 业务质量标准及证据要求
└── migration adapter        # 过渡期旧 executor 适配；迁移后删除
```

一个 Skill 被认为“已接入”，必须同时满足：

1. 可由统一 Manifest Resolver 选择，不读取任务关键词进入硬编码分支。
2. 可由统一 Capability Session 解析和按阶段装载。
3. Model 使用同一 R1 / R3 / R4 控制契约，不存在品类专属 Brief / Planner。
4. Photoshop 写入经过相同 Preflight、Policy、Trace 和写后读回。
5. 结果进入对应 Evaluation Profile，但最终仍由单一 `DesignVerdict` 裁决。
6. live E2E 能证明执行、读回、评价和交付；离线 fixture 只能证明拓扑。

## 6. 实施工作包

### G0：目标、基线与收益闸门

交付物：

- 单一目标与术语真相源。
- 当前 v3 / v5 / bridge / legacy 代码路径图。
- 通用 Agent 中品类分支、固定 Tool 笼子、平行状态源和重复契约的基线清单。
- 三类 Skill 的当前 E2E 缺口矩阵。

退出条件：后续每个治理切片都能说明“替换了哪段旧责任、减少了什么耦合、增加了什么真实证据”。只新增抽象层但不替换旧责任的改动不得计为收益。

### G1：单一生产运行时所有权

交付物：

- 一个 Runtime Session 拥有 R0、R1、R2、R3、R4、E1、R5、E2 状态。
- v3 负责真实执行、v5 负责契约的过渡事实被显式映射；不再允许 UI、executor、bridge 各自推进同一阶段。
- run record、resume、trace 和当前结果使用同一 run / stage / generation 标识。

退出条件：同一用户任务只能有一个当前 Runtime Session；阶段不能由普通 Tool success、UI 卡片或 legacy 状态机伪造推进。

当前实现状态（2026-07-13，前两片）：

- 已落地首个增量切片：manifest-bound 生产路径使用预签发 session / run / generation identity，Stage State 在运行中由 Runtime Session reducer 持有，Reflexion 保留 session lineage，Run Record 使用同一 runId。
- 已替换旧责任：移除 Agent 收尾阶段的 Trace→Stage State 重建；移除 Session 路径中 Run Record 结束时另造 runId 的责任。
- 已建立确定性门禁：R4 未 ready 不允许状态变更 Tool；一次写成功不能跳到 R5；R5 未通过且没有 delivery evidence 不能完成 E2。
- 已治理 Reflexion 语义连续性：新 generation 按 target 失效该阶段及下游 State /声明，只承接 target 之前、模型产生且 Harness 校验为 ready 的 Brief / Strategy / Plan；Run Record 只留 digest。
- 已将 R3 Strategy / R4 shadow Plan 作为只读 runtime context 下传 Skill bridge，但不授予 scheduler authority、Tool 权限或质量结论。
- 尚未满足 G1 退出条件：开放式无 Manifest 设计路径、完整 R2 / E1 节点级 Evidence、跨用户 /跨进程续跑及真实 Provider + Photoshop 多代 E2E 仍待验证。

### G2：Capability 发现、装载与执行边界

交付物：

- 六类 Capability 的统一 Catalog / Provider Binding / Session。
- 按阶段暴露能力，R1 / R3 只提供证据能力，R4 ready 后开放当前 Manifest 的执行能力。
- Tool metadata 统一声明只读、写入、外部生成、保存、交付和上下文副作用。

退出条件：能力可发现不等于已装载，已装载不等于获权，Tool success 不等于任务或质量通过；新增 Tool 的身份不再分散到多套不可校验名单。

### G3：从影子计划升级为有证据的任务图

交付物：

- R4 Plan 与执行 Journal 的稳定一一对账。
- 节点 ready / running / evidence_satisfied / failed / invalidated 状态机。
- 只读并行、写入串行、失败策略、freshness、跨轮恢复和 no-redo 的可测规则。
- Scheduler 只执行当前 Model 已声明且 Policy 允许的 ready 节点。

退出条件：先在 shadow 模式测得计划映射准确率、重复动作率、错误跳过率；达到项目设定阈值后，才在现有 Runtime 内逐步启用调度。未达到前不自动跳过 Photoshop 动作。

### G4：Context、Knowledge 与 Memory 收口

交付物：

- 当前任务上下文、长期 Memory、Knowledge 正文、Evidence 和运行摘要分层保存。
- Context Budget、压缩、失效和恢复规则。
- Knowledge 版本、新鲜度、撤回和本轮使用快照。
- 用户偏好、项目规则、商品事实保留来源和确认等级。

退出条件：旧上下文不能覆盖当前指令；长期状态不保存完整图片、Tool 结果或无界模型文本；模型能获得完成当前阶段所需的最小充分上下文。

首个编译切片（2026-07-13，已核实代码与离线生产拓扑）：

- autonomous Agent 已把稳定 System Policy 与运行上下文分离，并通过带来源、信任、槽位、阶段、新鲜度和预算的 Context Compiler 装配。
- 已复核 Memory 进入 `reviewed_memory`，外部参考与 Tool observation 进入 `data_only` 信封；二者不能注入 Policy 或执行授权。
- 关键 Policy 被编译器拒绝时 fail closed；编译摘要进入结果诊断，但不保存上下文正文。
- 尚未完成：完整聊天历史压缩、长期 Memory 生命周期治理、真实 Provider 上下文质量与 token 成本基线。

Prompt / Capability 权责切片（2026-07-13，已核实代码与专项离线拓扑）：

- 外部 P-01～P-20 已映射到现有 R0-R5/E1-E2；候选内容不创建第二 Router、Prompt Registry 或第三 Runtime。
- 通用 validator 拒绝固定 Prompt 顺序、独立 Runtime State，以及模型 Prompt 的 Tool 授权、执行、阶段推进和完成权。
- Global System Prompt 已去除固定设计团队角色链、CSV 专属处理流程和具体 Tool 名；Tool semantics 与执行纪律进入 `capability_policy`。
- P-06～P-11 的专业方法仍需按后续切片迁入现有 Knowledge / Skill / Evaluation Profile；本切片不证明设计质量提升。

### G5：三类业务 Skill 迁移

交付物：

- 主图、详情页、SKU 各自只有一个正式 Manifest 和一个迁移期 executor adapter。
- 专业方法论、输入输出、业务证据和评价标准留在 Skill / Knowledge / Evaluation，不进入通用 Agent。
- 删除或收敛 executor 内与品类绑定的状态机、Tool 白名单和 Prompt 分支。

退出条件：三类 Skill 走同一 R0-R5/E1-E2 Harness；增加第四个 Skill 的演练不需要修改 Agent 循环、Planner validator、Policy 核心或 UI 发送管线。

### G6：Evaluation、Reflexion 与停止条件

交付物：

- 写后结构读回、视觉读回、业务 Evidence Adapter、Evaluation Profile 和唯一 DesignVerdict。
- 失败分类：缺输入、能力不可用、执行失败、证据不足、质量不通过、Policy 阻断。
- Reflexion 只输出下一轮约束或修订建议，不直接伪造设计结果。
- 最大轮次、最大重复、不可恢复失败和用户审批停止条件。

退出条件：任何“完成”都能追溯到交付 Evidence；质量失败会引发有界修订或诚实停止，不会无限微调或静默成功。

### G7：真实 E2E 与旧路径退役

交付物：

- 主图、详情页、SKU 各一套真实 Provider + 一次性 Photoshop 文档验收样本。
- 每套样本包含 Skill 选择、Brief、Evidence、Strategy、Plan、实际写入、读回、Evaluation、DesignVerdict 和交付记录。
- legacy / bridge 责任清单及逐项删除条件。

退出条件：三类 Skill 连续通过约定样本；失败可定位到 Model、Harness、Capability、Tool、Evidence 或 Evaluation 层；被替代的旧分支被删除，而不是长期双跑。

## 7. 开发收益判断

治理改动只有同时满足以下条件才算正收益：

1. 降低耦合：通用 Agent 中的品类判断、固定 Tool 面或重复状态源减少。
2. 提高可扩展性：新增 Skill 主要新增声明和专业能力，不修改核心循环。
3. 提高真实性：更多状态由真实 Evidence 推进，假成功和离线拓扑冒充 live 完成的空间减少。
4. 提高可维护性：同一概念只有一个 owner、一个契约和一个验证入口。
5. 控制运行成本：模型每阶段只看到最小充分 Capability，不因治理增加无界 schema 和上下文。

出现以下情况时应停止继续引入并先治理已有实现：

- 新增 Manifest、Registry、Runtime 或状态机，但旧责任没有退役。
- 为主图、详情页、SKU 分别复制相同 Harness 逻辑。
- 为让测试通过而放宽 validator、补造 Evidence 或把固定模板写入 Agent。
- 离线 Smoke 增多，但真实 Provider + Photoshop 的失败定位能力没有改善。
- Capability Layer 只增加命名层，实际 Tool 身份、权限和结果仍由旧分支决定。

## 8. 总体验收矩阵

| 维度 | 最低验收标准 |
|---|---|
| 架构 | 一个生产 Runtime Session；Agent 核心无主图/详情页/SKU 流程分支；无第三套 DAG Runtime |
| 规划 | Model 拥有 Brief / Strategy / Plan 内容；Harness 只校验、调度和约束；计划可重申、可失效 |
| 能力 | Capability 可发现、按阶段装载、执行点授权；Skill / Tool / Knowledge / Memory / Evaluation / Policy 边界可审计 |
| 上下文 | 当前 Evidence、长期 Memory 和摘要分层；有界、可失效、可恢复，不保存无界敏感载荷 |
| 执行 | Photoshop 写入串行、有授权、有读回；失败不静默；节点状态来自真实结果 |
| 评价 | Tool success、任务完成和设计质量严格分离；只有唯一 DesignVerdict 可声明质量结论 |
| 扩展 | 第四个 Skill 接入演练不修改 Agent 核心和通用 Harness 规则 |
| 实机 | 主图、详情页、SKU 均有真实 Provider + 一次性 Photoshop E2E 证据 |

## 9. 明确非目标

1. 不训练、微调或通过升级模型来代替 Harness 治理。
2. 不一次性重写全部 v3，也不新建与 v3 / v5 并行的第三套运行时。
3. 不追求“任意设计都能一次生成”的不可验收目标。
4. 不把 Knowledge 全部内嵌进系统 Prompt，不建设无明确消费者的重型知识图谱。
5. 不把三个业务 Skill 的固定工作流包装成“动态规划”。
6. 不以契约数量、Smoke 数量或单张成功截图作为最终完成标准。

## 10. 首版量化阶段门槛

以下数字是第一版工程门槛，用于阻止阶段提前跳级。G0 可以根据真实基线提出调整，但必须记录原因和新旧数值，不能在失败后静默放宽。

| 阶段 | 进入下一阶段前的最低门槛 |
|---|---|
| G0 → G1 | R0-R5/E1-E2 每个阶段均列出唯一 owner、真实推进事件和持久化位置；通用 Agent 品类耦合、重复状态源、Capability 身份分散点和三 Skill E2E 缺口均有文件 /函数证据，未知项为 0 或显式挂账 |
| G1 → G2 | 同一任务只有一个 active Runtime Session；普通 Tool success、UI 卡片和 legacy executor 均不能直接推进阶段；跨轮 run / stage / generation 身份在专项样本中 100% 一致 |
| G2 → G3 | 主图、详情页、SKU 的 R1 初始模型面继续不高于当前 12 schema 基线；R4 前业务 Skill /写入 /交付可见数为 0；Manifest 可发现能力在 R4 后完整恢复；新增未知 Tool 必须被 audit 阻断 |
| G3 shadow → canary | 至少 20 个计划样本且每个 Skill 不少于 5 个；计划节点与执行观察归属准确率不低于 95%；错误自动跳过为 0；计划外 Photoshop 写入为 0；所有失败和多义映射都保持 fail closed |
| G3 canary → default | 至少 10 个一次性 Photoshop canary 任务；no-redo 错误跳过为 0；写节点依赖越序为 0；Scheduler 失败均能回退到诚实停止或模型重规划，不静默续跑 |
| G4 → G5 | 长期记录中完整图片、base64、完整 Tool result、完整 Plan 和无界模型文本泄漏为 0；过期 Knowledge / Memory 进入当前 prompt context 的负向样本通过率为 0 |
| G5 → G6 | 三个 Skill 均走同一 Brief / Strategy / Plan / Policy / Trace 主链；通用 `agent.ts`、`engine.ts`、Planner validator 和 ChatPanel 发送管线中的新增品类分支为 0；第四 Skill 演练不修改这些核心文件 |
| G6 → G7 | 每次成功 Photoshop 写入后都有结构或视觉读回；负向样本中 Tool success 被误判为质量 passed 的次数为 0；交付记录缺 DesignVerdict 时 E2 通过率为 0 |
| G7 完成 | 主图、详情页、SKU 各至少 3 个真实 Provider +一次性 Photoshop 样本，并各含至少 1 个失败恢复或诚实停止样本；9 个正常样本均具有写入、读回、Evaluation、DesignVerdict 和交付证据；未满足项不得标记 `photoshop_e2e_verified` |

这些门槛证明的是运行时治理、证据链和扩展边界，不直接证明设计审美已经达到商业上线标准。商业审美仍需由各 Skill 的 Evaluation Profile、视觉证据和必要人工验收单独判断。
