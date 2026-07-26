# Design Agent Prompt 与 Capability 治理落地规范

## 1. 文档定位

本文把外部 P-01～P-20 提示词方案映射到 DesignEcho 现有 Agent OS。它不是新的万能 Prompt、Prompt Registry、Workflow Runtime 或状态机，也不替代：

- `project-memory/Prompt.md`：项目目标和范围真相源；
- `docs/design-agent-operating-system.md`：Agent OS 架构真相源；
- v3：当前真实执行路径；
- v5 Runtime Session：R0–R5/E1–E2 阶段、证据与治理契约；
- Skill Manifest、Capability Resolver、Tool preflight 和 Completion gate：生产权威。

外部文本只作为 Prompt、Artifact 和 Skill 候选规范。候选内容必须通过本文的权责映射与代码审计后，才能进入现有生产路径。

## 2. 治理目标

项目目标不是继续扩展固定业务入口，也不是用更长 Prompt 提高模型表现，而是形成能够适应复杂设计任务的专业智能工作系统：

```text
Agent = Model + Harness
```

Model 负责：

- 理解用户目标；
- 多模态判断；
- 设计策略；
- 动态计划内容；
- 基于证据提出评价与修订建议。

Harness 负责：

- Runtime Session 和阶段状态；
- Capability 发现、解析与按阶段装载；
- Context 信任、预算和新鲜度；
- Tool 权限、串并行、执行和目标绑定；
- Evidence、Evaluation、停止条件和交付事实；
- 失败恢复、追踪、成本和审计。

核心不变量：模型内容不能自动获得执行权、阶段推进权或完成权。

## 3. Prompt 权责模型

每个 Prompt 或 Prompt-like 模块必须声明：

| 字段 | 含义 |
|---|---|
| owner | model、runtime、skill、tool、memory、evaluation 或 policy |
| implementation | model_prompt、deterministic_code 或 hybrid |
| authority | advisory、declarative、execution 或 completion |
| scope | global、capability 或 skill |
| activation | always、runtime_conditioned 或 on_demand |
| stages | 复用现有 R0–R5/E1–E2，不创建新状态枚举 |
| capabilityKinds | Knowledge、Skill、Tool、Memory、Evaluation、Policy |
| skillIds | 只有 Skill scope 可绑定 Manifest identity |

强制规则：

1. model_prompt 和 hybrid 只能拥有 advisory 或 declarative 权威。
2. Prompt 不得授予 Tool 权限、执行 Tool、推进 Runtime Stage 或声明完成。
3. execution 和 completion 权威只能由 deterministic_code 承担。
4. Global Prompt 不得绑定主图、详情页、SKU 或未来品类 Skill。
5. Skill Prompt 只能按 Manifest 与当前阶段按需装载，不能 always active。
6. Prompt 不得定义生产固定顺序，也不得创建独立 Runtime State。
7. Prompt 输出必须继续经过 Schema、Registry、Policy、State transition 和 Evidence 校验。

生产校验器：`src/shared/agent-runtime-v5/prompt-capability-governance.ts`。

治理审计：`scripts/audit-prompt-capability-governance.cjs`。

## 4. P-01～P-20 现有架构映射

| 候选 | 现有阶段 | 正确 owner / authority | 落地方式 | 禁止事项 |
|---|---|---|---|---|
| P-01 Brief | R1 | model / declarative | 复用 Runtime Design Brief 声明与 validator | 不建第二 Brief 状态机 |
| P-02 Capability Router | R0 | runtime / declarative | 合并到现有 Manifest Resolver 和 Capability Session | 不新增 Prompt Router |
| P-03 Task Planner | R4 | model / declarative | 复用 Runtime Action Plan；当前保持 shadow | 不新建第三套 DAG Runtime |
| P-04 Asset Inspector | R2 | model / declarative | Tool 观察事实 +视觉模型解释，形成 Evidence | 不把模型推断写成素材事实 |
| P-05 Brand Profile | R2/R3 | memory / advisory | 项目规则、品牌来源和 reviewed Memory | 不把历史案例直接升级为 Policy |
| P-06 Content Strategy | R3 | skill / declarative | Skill 方法论 + Knowledge +事实引用 | 不写入 Global Prompt |
| P-07 Art Direction | R3 | skill / declarative | Runtime Design Strategy 内容候选 | 不授予执行权 |
| P-08 Layout Planner | R4 | skill / declarative | 复用 Layout DSL / Action Plan，可按任务省略 | 不作为所有任务必经节点 |
| P-09 Main Image | R3/R4 | skill / declarative | `ecommerce.main_image` Skill Package | 不在 Agent 核心维护主图分支 |
| P-10 Detail Page | R3/R4 | skill / declarative | `ecommerce.detail_page` Skill Package | 不在 executor 新增长流程状态机 |
| P-11 SKU | R3/R4 | skill / declarative | `ecommerce.sku_batch` Skill Package | 不把共享结构误做固定模板 |
| P-12 Brand KV | R3/R4 | skill / declarative | candidate-only；有真实 provider 前不注册生产能力 | 不外推为已具备品牌全场景能力 |
| P-13 Photoshop Compiler | R4 | model / declarative | 模型声明语义动作；Harness 校验为 Typed Tool | 不输出任意脚本或 batchPlay |
| P-14 Execution Controller | E1 | runtime / execution | Agent Runtime、preflight、Tool dispatcher、journal | 模型不得成为事务执行器 |
| P-15 Observer | E1 | runtime / declarative | 结构读回、视觉证据和同目标 binding | success=true 不得代替读回 |
| P-16 QA Evaluator | R5 | evaluation / declarative | Skill Evaluation Profile +唯一 DesignVerdict | 模型分数不得直接推进 R5/E2 |
| P-17 Repair Planner | R5→R4 | model / advisory | Reflexion handoff 与有界修订 | 不无限循环、不直接执行修复 |
| P-18 Completion Gate | E2 | runtime / completion | Runtime completion contract + delivery evidence | Prompt 不得拥有完成权 |
| P-19 Memory Writer | E2 | memory / advisory | 只生成 review candidate | 不直接覆盖长期 Memory |
| P-20 Context Compactor | 全阶段 | runtime / advisory | 结构字段确定性保留；文本可辅助压缩 | 不改变事实、不创建第二 Context Store |

## 5. 动态规划与 DAG 的工程边界

动态规划不是让模型自由输出任意 Photoshop 脚本，也不是所有任务都走同一链路。

正确路径：

```text
用户目标
→ R0 选择 Manifest / Capability
→ Runtime 根据当前 Evidence 激活需要的阶段
→ Model 声明 Brief / Strategy / Plan 内容
→ Harness 校验依赖、权限和 Capability
→ E1 串行执行状态变更并绑定同目标读回
→ R5 根据 Skill Profile 评价
→ Reflexion 修订或 E2 交付
```

任务可以省略不必要的专业 Artifact：

- 机械移动图层不需要完整 Art Direction；
- 只读审计不需要 PhotoshopExecutionPlan；
- 从零设计通常需要 Brief、Evidence、Strategy 和 Plan；
- Skill Manifest 决定最低阶段和输入，Model 决定本轮内容，Harness 决定是否可执行。

R4 Action Plan 目前仍是 shadow evidence，不是自动 Scheduler。只有在真实 Provider + Photoshop 样本中测得节点归属准确率、重复动作率、错误跳过率和恢复正确率后，才能逐步启用调度权。

## 6. Capability Layer 落地结构

```text
Capability System
├── Knowledge：版本化事实、设计原则、方法和品牌来源
├── Skill：目标、方法、输入输出、阶段、质量和评价规则
├── Tool：原子动作、Schema、副作用、目标与读回语义
├── Memory：用户偏好、项目规则、经验候选和复核状态
├── Evaluation：Skill Profile、Evidence Adapter、DesignVerdict
└── Policy：授权、安全、品牌硬规则和审批
```

六类能力必须保持 provider identity 和边界。知识不能伪装成 Tool，Skill 不能变成固定 Tool 顺序，Memory 不能覆盖当前指令，Evaluation 不能根据平均分绕过硬门禁，Policy 不能只存在于 Prompt 文本。

## 7. Global Prompt 治理

Global System Prompt 只允许保留稳定不变量：

- Agent 身份和目标；
- Model / Harness 分工；
- 动态最短可靠路径；
- 不编造事实和执行结果；
- 不把能力可见性当权限；
- 只有 Runtime Evidence 才能支持完成声明；
- 面向用户的公开计划和真实结果表达。

以下内容不得进入 Global Prompt：

- 主图、详情页、SKU 等品类方法；
- 固定设计团队角色顺序；
- CSV、模板或某类业务的固定处理流程；
- 具体 Tool 名清单；
- 独立任务状态机；
- 固定 20 步调用链。

Tool semantics、设计纪律和能力使用说明进入 `capability_policy`；项目事实、Memory、外部参考和 Tool observation 继续通过 Context Compiler 的独立信任槽位装配。

## 8. Artifact 收口原则

外部文本中的 Artifact 名称不直接新增成第二套数据模型，应先映射到现有权威：

| 候选 Artifact | 当前权威 |
|---|---|
| TaskBrief / CompletionContract | Runtime Design Brief + task completion contract |
| AssetManifest | R2 Evidence / Project State asset evidence |
| BrandProfile | governed project rules + reviewed Memory |
| ContentSpec / ArtDirection | Runtime Design Strategy / Skill context |
| LayoutSpec / TaskGraph | Layout DSL + Runtime Action Plan |
| PhotoshopExecutionPlan | R4 declaration + Typed Tool preflight |
| DocumentSnapshot / ObservationReport | Tool evidence + E1 target binding |
| QAReport | Evaluation Profile result + DesignVerdict |
| RevisionPlan | Reflexion handoff |
| CompletionDecision | Runtime Session E2 transition |
| MemoryCandidates | Memory review queue |
| CompactTaskState | Context Compiler / Run Record digest |

只有现有契约无法表达且存在真实消费者、持久化 owner 和验收样本时，才新增 Artifact Schema。

## 9. 分阶段实施计划

### 切片 A：Prompt 权责与全局核心治理

状态：本轮已完成代码与离线拓扑验证。

- Prompt/Capability 权责 validator；
- P-01～P-20 审计映射；
- Global Prompt 去固定角色链、业务流程和具体 Tool 名；
- Capability policy 与 System policy 分槽；
- agent-fast 审计门禁。

### 切片 B：Skill 方法论迁移

状态：已完成代码接线与离线验证。

- 把 P-06～P-11 中可复用方法拆入对应 Knowledge / Skill / Evaluation Profile；
- 三个生产 Skill 不复制同一通用方法全文；
- P-12 Brand KV 保持 candidate-only，先补 provider 与验收，不提前注册。

退出条件：第四个测试 Skill 只通过 Manifest / provider 接入，不修改 Agent 核心。

### 切片 C：Artifact 别名与消费者审计

状态：已完成。16 个 alias 映射到现有 14 个 canonical owner；审计不创建 Registry 或 Schema。

- 建立候选 Artifact 到现有契约的机器可审计映射；
- 找出真正缺失的数据字段、owner、消费者和持久化位置；
- 禁止只因外部文档出现新名词就新增 Schema。

退出条件：同一事实只有一个生产 owner；旧名词只能作为 adapter alias。

### 切片 D：R4 TaskGraph 证据成熟度

状态：指标与门禁已完成；尚无合格真实样本，R4 继续保持 shadow。

- 测量真实节点归属、同目标 Evidence、重复动作和恢复准确率；
- 保持写操作串行、只读可并行；
- 未达到阈值前不启用自动 skip 或 Scheduler。

### 切片 E：Knowledge / Memory / Evaluation 深化

状态：现有治理链已复核并补齐方法绑定。Knowledge 使用版本/生命周期/usage snapshot；Memory 保持 review/expiry/禁执行；三个 Skill Profile 与方法引用和 Manifest 一致。

- Knowledge 版本、新鲜度、撤回和使用快照；
- Memory candidate review、冲突与 expiry；
- Skill-scoped Evaluation Profile 和硬门禁；
- 视觉评分必须带证据来源，不使用伪精确数字替代质量事实。

### 切片 F：真实 E2E 与退役旧责任

- 主图、详情页、SKU 分别运行真实 Provider +一次性 Photoshop 文档；
- 核对 Brief、Evidence、Strategy、Plan、E1 binding、DesignVerdict 和 Delivery；
- 每个新切片必须删除或退役一段旧 Prompt、旧状态或旧品类分支。

## 10. 验收标准

1. Global System Prompt 不出现品类方法、固定角色链或具体 Tool 工作流。
2. model_prompt / hybrid 无法通过契约获得 execution、completion、permission 或 stage authority。
3. P-01～P-20 全部映射到现有 Stage 和 Capability，不创建第二 Router 或第三 Runtime。
4. Skill 方法只有 Manifest 激活时进入 Context。
5. Tool write 必须经过 preflight、目标绑定和后续读回。
6. Completion 必须由 R5 passed + delivery evidence 推进。
7. Context 继续区分 System、Policy、Project、Memory、Runtime、External 和 Tool observation。
8. agent-fast、Renderer 类型检查、无警告构建和 live E2E 分层记录，不能互相冒充。

## 11. 当前事实边界

截至 2026-07-13：

- 已完成 Prompt 权责契约、20 个候选映射审计和 Global / Capability Policy 分槽；
- 已有 Context Compiler、Runtime Session、Skill Package validator、E1 target binding 和 Runtime Accounting；
- 本轮没有新增 Prompt Registry、Capability Router、DAG Runtime 或生产 Skill；已新增非执行 Knowledge Provider、Artifact alias validator 和只读 maturity evaluator；
- 本轮验证的是治理边界，不证明模型设计质量提升；
- UXP Bridge 与只读 live preflight 已通过，但三 Skill runner 仍为 partial，真实 Provider + 一次性 Photoshop 写入 E2E 尚未完成；
- Brand KV、自动 Scheduler 和独立 Artifact 系统仍未实现，其中后两者是明确不应在当前证据下引入的能力。
