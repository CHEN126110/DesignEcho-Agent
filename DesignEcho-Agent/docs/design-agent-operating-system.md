# Design Agent OS 架构真相源

日期：2026-05-08

## 1. 文档定位

本文件是 DesignEcho 设计智能体的顶层架构入口，用于回答一个核心问题：

用户提出任意设计相关需求时，Agent 应该如何理解、组织上下文、选择能力、调用 Photoshop、验收结果并继续修正。

本文件不是宣传文案，也不声明“自动设计能力已经完成”。当前项目已有 Agent 基础设施、Photoshop 工具、参考图复刻、主图、SKU、详情页、文案和知识入口等多个局部能力，但这些能力必须被统一到同一个控制系统下，不能继续以孤立技能或硬编码场景扩张。

### 1.1 当前可实施目标

长期产品目标是一个能够处理开放式设计任务、使用专业知识并通过 Adobe Photoshop 完成真实交付的设计 Agent。当前目标不是抽象地“提高 Agent 智能”，也不是增加更多 Prompt、Manifest 或业务流程，而是在不训练或升级基础模型、不把主图 /详情页 /SKU 写入通用 Agent 核心的前提下，把 v3 真实执行与 v5 治理契约收口为一条生产运行时，并让同一 Runtime Session 拥有 R0-R5/E1-E2 状态、上下文、观察、运行记录与质量检查。

主图、详情页、SKU 是第一批可插拔 Skill 验收对象，不是 Agent 的能力边界。后续海报、社媒视觉、包装或其他设计任务应通过新增 Skill / Knowledge / Evaluation 扩展，而不是向通用 Agent 增加品类流程。最终完成必须由真实 Provider +一次性 Photoshop 文档的执行、写后读回、Evaluation、DesignVerdict 和交付检查共同确认；契约存在、离线 Smoke 或单张成功截图都不是完成。

具体的概念到代码映射、Skill 包结构、G0-G7 工作包、收益闸门和验收矩阵见 `docs/agent-governance-implementation-objective.md`。该文档负责实施分解，不建立第二套架构。

## 2. Agent、Model 与 Harness 定义

DesignEcho Agent 不是工具列表、固定关键词路由或预先写死的自动化流程。权威定义是：

```text
Agent = Model + Harness
```

1. Model 提供推理、语言理解、多模态理解和规划能力，决定 Agent 的智能上限。
2. Harness 提供任务管理、上下文管理、能力发现、工具调用、知识访问、记忆、工作流、权限、状态和评价闭环，决定模型能否稳定完成真实任务。
3. Agent 是两者组成的完整智能工作系统。Agent 不等于 Harness；Harness 也不能把某个业务品类的知识、模板或固定步骤伪装成 Agent 本身。

完整 Agent 应该能够：

1. 理解用户真实意图。
2. 组织项目、素材、Photoshop 文档、历史任务和用户约束。
3. 判断需要哪些设计知识、视觉理解、Photoshop 操作和质量检查。
4. 生成可执行计划，而不是把模型输出直接当成 Photoshop 动作。
5. 调用工具执行，并记录每一步真实结果。
6. 用 Photoshop 状态、图层、bounds、截图或报告验证结果。
7. 在失败、置信度不足、观察不足或质量检查不完整时降级、请求补充或给出可修复原因。

主图、SKU、详情页、参考图复刻、文案撰写、抠图、局部重绘、形态处理都只是这个控制系统上的场景或工具，不是 Agent 的边界。

### 2.1 Harness 的稳定职责

Harness 负责跨任务保持一致的运行能力：任务和状态管理、上下文裁剪与恢复、Capability 发现与装载、工具调度、权限和安全、执行追踪、观察回读、评价回流、失败恢复与停止条件。

Harness 不负责定义“详情页必须几屏”“主图必须先做哪一步”或“所有设计必须先调用 renderLayout”这类专业能力内容。此类目标、方法、输入输出和质量标准归 Skill；事实、规则、方法论及其来源记录归 Knowledge；可执行动作归 Tool。

### 2.2 Capability Layer

专业能力独立于 Agent 核心，通过统一 Capability Layer 被 Harness 发现和装载：

```text
Capability Layer
├── Knowledge
├── Skill
├── Tool
├── Memory
├── Evaluation
└── Policy
```

1. Knowledge 回答“这个领域有什么事实、规则和方法论”。
2. Skill 回答“如何完成某类专业任务”，至少声明能力目标、方法论、可调整的执行过程、输入要求、输出结构、质量标准和评价规则。Skill 是可插拔能力包，不是原子 Tool，也不属于 Agent 核心。
3. Tool 回答“可以执行什么动作”，只负责与 Photoshop、文件系统、检索、图像模型等外部环境交互，并返回可审计工具结果或读回记录。
4. Memory 保存用户偏好、品牌规范、项目事实、历史结果和经审核的经验；旧记忆不得覆盖当前用户指令或真实环境状态。
5. Evaluation 判断目标、规则和质量是否达成，必须基于结构读回、视觉观察或明确人工复核，不以工具成功代替设计质量通过。
6. Policy 定义权限、安全、品牌、审批、并发、观察要求和停止边界。Policy 约束自由执行，但不替 Agent 选择固定业务路线。

### 2.3 动态规划与 Workflow / DAG

模型根据用户目标、当前状态、环境反馈和任务复杂度动态形成或调整计划；Harness 负责保存和执行计划状态。复杂任务可以使用 Workflow / DAG 表达任务依赖、并行机会、失败重试、回退和续跑，但任务图不能退化成固定 Photoshop 调用脚本。

DAG 是 Harness 的一种编排能力，不是 Agent 的全部，也不是 Skill 的替代品。Skill 可以提供建议阶段、依赖约束和验收标准；Planner 依据当前任务选择、裁剪、展开或改写任务图。新增 Skill 不应要求修改通用 Orchestrator。

动态规划的运行边界：

1. 用户已明确授权自主执行时，任务进入 Agent runtime，由 Planner 根据上下文选择 Knowledge、Skill 和 Tool；不能再用主图、详情页、SKU 等品类信号白名单决定 Agent 是否有规划自由。
2. `candidate_only` 或真正缺少关键授权的请求可以先形成公开计划；普通任务文本、Photoshop 连接状态和“交付/保存/验收”等措辞不能伪造用户批准。
3. public-plan 只是能力中立、可审查、可回放的执行信封，不得强制 `createDocument → renderLayout`、默认画布、占位文案、品类模块或 Skill 阶段计划。
4. 显式确认必须绑定一条真实的待确认计划；确认后仍受工具白名单、参数校验、写后读回、执行作用域和项目写入审批约束。
5. 通用 runner 不得从文档名、preset 或工具参数反推某个 Skill 的专业 Policy。详情页 `stagePlan` 等专属标准只能由已装载的 Skill / Capability 契约启用。
6. R4 动态计划必须由模型基于已验证 R3 策略、当前上下文和 Capability Resolution 显式声明；Harness 只能验证依赖图和语义 DSL。普通 Tool call、assistant prose 或旧关键词 Planner 都不能补造成完整计划。

### 2.4 Runtime Session 与阶段所有权

Runtime Session 是一次用户目标及其有界修订过程的生产身份与阶段状态容器，不是新的业务流程，也不是第三套 Runtime。

1. 同一任务共享一个 `sessionId`；首次执行和每次 Reflexion 使用独立的预签发 `runId`，`generation` 单调递增，`parentRunId` 指向上一代。
2. Runtime Session 绑定当前 Manifest Stage Plan，并在运行中持有唯一 Stage State 与 append-only Stage Trace；Trace 是观察账本，不能在收尾反向重建或覆盖 State。
3. R1 / R3 / R4 只能由模型声明经过对应 validator 后推进；R2 由项目与画面观察推进，E1 由目标绑定的写入和同目标读回推进，R5 由 DesignVerdict 推进，E2 由真实交付结果推进。
4. 普通 Tool success、UI 卡片、legacy 状态机和 assistant 文本都不能越权推进阶段。普通确认只暂停当前阶段，不得跳到交付阶段。
5. Photoshop 写入、保存、导出和外部生成必须在 R4 ready 后执行；一次写成功仍需后续读回，R5 未通过时不得宣称 E2 或 completed。
6. Reflexion 新 generation 继承 Session lineage，并按回退目标只承接该目标之前、模型产生且 Harness 已校验的 ready Brief / Strategy / Plan；目标及下游 State 与声明必须失效。旧 Resume record 只提供 digest、待核实节点和历史运行摘要，不自动恢复完整声明或当前活动 Session。

截至 2026-07-13，上述 identity、运行中 reducer、R4 前写入门禁、R5 / E2 完成门禁、Reflexion lineage 和同 Session planning-context carry 已接入 manifest-bound 生产路径；R3 Strategy / R4 Plan 也能作为只读上下文进入 Skill bridge。开放式无 Manifest 设计路径尚未全部覆盖。R4 仍是 shadow Plan，不是可执行 DAG Scheduler，真实 Provider + Photoshop 多代 E2E 仍待验证。

### 2.5 Context 信任与最小编译

Context Compiler 是现有 Agent Prompt 装配的治理层，不是新的 Memory 平台或第三套 Runtime。

1. 每项上下文必须声明来源、信任等级、槽位、适用阶段、新鲜度和优先级；会发生语义竞争的状态还必须声明稳定 `conflictKey`，有时效的观察必须携带可验证时间或到期时间。
2. `trusted_system / trusted_policy` 只承载 Harness 与 Policy；用户输入、项目事实、已复核 Memory、历史对话、外部参考和 Tool observation 不得拼接进 System Policy。Router 中的固定规则、Capability 目录与领域 Knowledge 也必须分槽，不能为节省消息数重新混成一段。
3. 每次运行只能有一个当前用户指令入口。Harness 恢复控制使用 `policy` authority，只能约束当前运行，不能扩大用户授权或改写目标；Runtime / 视觉观察和历史对话使用 `data_only`，即使 Provider 协议要求它们以 user role 传输，也不能取得 user authority。
4. 外部参考、Tool observation 与历史内容必须放进显式 data-only envelope；内容行与边界分隔，保留结束标签必须转义。它们不得携带授权、阶段推进或完成事实，Tool 自带的 envelope 也不能自我提权。
5. 编译器先按 required、priority、trust 与 freshness 选择，再应用总预算；同一冲突域只保留一个胜者，过期项 fail closed。关键项被拒绝时调用方必须停止或显式降级，非关键项裁剪留下可审计 issue。
6. 运行中裁剪以完整消息单元和 Tool exchange 为边界：System 与当前用户目标固定保留；assistant Tool call 与完整 result 一起保留或整体移除；旧 Tool 结果只允许结构化摘要，并由 Harness 重签 data-only envelope。
7. 当前生产切片覆盖 autonomous Agent、Router、Conversational、项目 / Photoshop 运行上下文、已复核 Memory、对话历史和模型可见 Tool 返回。长期 Memory 的跨会话衰减、用户治理和真实模型污染基准仍属于后续 G4。

#### 2.5.1 Agent 运行态情境认知

Agent 对“我是谁、DesignEcho 是什么、用户现在指向哪里”的理解分为两个不同层次，不能继续散落在页面文案、Prompt 片段和工具返回中各自猜测：

1. `AgentOperatingProfile` 是稳定、版本化的身份与产品语义：主控 Agent 负责对话中的目标理解和动态计划；工作流是用户与 Agent 共同编辑、复用和传播的流程资产；Skill 是可选的专业能力包。该 Profile 只提供语义，不授予 Tool 权限，也不证明 Photoshop 已连接。
2. `OperatingContextSnapshot` 是一次请求绑定的只读事实快照：包含当前项目、活动页面、工作流文档 / revision / 选中节点、选中素材，以及 Photoshop 连接 / documentId / activeLayerId。它不是全局 Context Store，不持久化图片或无界 Tool payload，也不创建 Runtime；Capability 可见性属于 Capability Session，执行授权属于 execution preflight，二者不得复制进快照形成第二真相源。
3. 每项运行事实必须携带 `source / observedAt / revision / freshness`；相互矛盾、缺稳定身份或超过有效期的 Host 事实必须显式降级，不能被提示词重新包装成 current。
4. Workbench 只投影用户当前选择，ChatPanel 在发送边界复制并冻结本轮快照；发送后切换页面、节点或项目不得改写已经开始的请求。项目异步采集期间身份变化必须拒绝混合旧项目与新项目。
5. 用户说“这个 / 这里 / 当前图层”时，只能绑定快照中的唯一稳定对象引用；没有唯一引用时必须说明歧义。稳定引用用于 grounding，不等于授权，也不能替代写入前对真实 Photoshop 目标的复核。
6. 快照只以 `runtime_context + tool_observation` 进入现有 Context Compiler。Capability Session 继续拥有模型可见 schema，execution preflight 继续拥有执行授权，Runtime Session 继续拥有阶段、观察与运行记录；不得因此建立第二 Context 编译链、第二 Capability Registry 或第三 Runtime。
7. 后续版本化 `WorkflowDefinition`、用户 / Agent 共同编辑和画布运行投影必须消费同一请求 / Runtime 身份与事实源。画布展示节点运行状态，右侧对话展示同一运行的设计判断、必要观察、质量结论和结果；两者不是两套执行器。

最终验收仍是生产 Agent 使用真实 Provider 与 Photoshop 完成观察、理解、策略、计划、执行、读回、评价、修正和交付。离线快照 Smoke、UI 接线、fixture Provider 或单 Tool 成功只证明地基，不得升级为真实设计能力完成。

### 2.6 Runtime Accounting

Runtime Accounting 是 Runtime Session 的只观察账本，不是执行预算器。

1. 记录模型与 Tool 的真实调用次数、失败次数和实测耗时，并按 stage 聚合。
2. token 只接受 provider 明确上报；缺失时增加 `unreportedUsageCallCount`，不做字符数估算。
3. 价格未配置时成本状态保持 `not_configured`，不能输出伪精确金额。
4. recovery 与 Reflexion 只记录真实发生次数；账本不得改变授权、调度、DesignVerdict 或最终结果。
5. Runtime Session digest 与 Run Record 保存摘要，不保存完整 Prompt、图片或无界 Tool payload。

### 2.6.1 Artifact Repository 与权威引用

Artifact Repository 是 Artifact 正文、二进制、权威 hash 和版本 lineage 的唯一生产 owner，不是第二 Runtime、Project State、任务 Store 或 Release Gate。

1. Repository 只在主进程存在一个文件型 owner。Runtime 收尾前，顶层主窗口必须先取得主进程签发的一次性 finalization capability；grant 绑定 sender、canonical real project path、manifest 的 canonical `skillId / taskType`、主进程生成的 `sessionId / runId / generation` 与过期时间，Renderer 不能自报项目或运行身份。
2. Finalization 请求外层只允许 `version / authorizationToken / artifacts`。Brief、Strategy、Action Plan、Evaluation / DesignVerdict 与 Delivery Verification 分别通过严格声明 reader 后，主进程才生成 canonical artifact type、确定性 ID、producer、累积 source refs 与 revision；Repository 再校验上游引用和 supersede 关系、自行计算权威 hash 并写入 payload 与 lineage。
3. token 使用两阶段提交协议，状态机为 `issued → finalizing → completed`，并固定首次 finalization 声明批次 hash；发布中途失败只允许同一批次精确重试，内容变化或成功后的重放必须拒绝。只有父 run 已完成时才允许签发下一 generation，且每个父 run 最多拥有一个 child。
4. 只有当前主窗口的顶层 frame 可以申请或消费 capability；ResourceManager 已登记活动项目时，请求项目必须与其 canonical path 完全一致。未登记活动项目时保留兼容入口，但 token 仍绑定显式 canonical project、sender 与 manifest。
5. `ArtifactRef` 只允许 `artifactId / artifactType / contentHash` 三个字段。RuntimeTaskSnapshot、Design Project State 与 Run Record 只能保存 Repository reader 返回的引用，不复制正文、二进制、物理路径或临时文件信息。Project State 的 Repository 投影由主进程 coordinator 按 `Repository → State` 固定锁顺序更新，普通 State patch 不可信任磁盘中的 `artifactRefs`，读取时从 Repository 重建。
6. 运行级读取必须绑定完整 `sessionId / runId / generation`。scope 不一致、引用结构非法、正文缺失、hash 不一致或 Repository 损坏时必须 fail closed；调用方不能通过普通 result data、消息、UI 状态或持久化记录补造引用。
7. alias 只用于外部命名到 canonical artifact type 的映射；alias、外部路径、临时文件、调用方 hash、内嵌结果载荷和同形对象均没有 Artifact 发布权威。
8. Repository 发布或读取成功不授予 Tool 权限，不推进 Runtime Stage，不形成 Approval，不证明 DesignVerdict、视觉质量、Delivery 或任务完成；这些责任仍由 execution preflight、Runtime reducer、Evaluation、ApprovalService、Delivery Verification 与后续统一 Release Gate 各自拥有。
9. `runtime-task-snapshot/v0` 表示 Repository 未连接的 fail-closed 投影，必须保持 `artifactRefs=[]` 与 `artifactRepositoryConnected=false`；只有严格 Repository 投影与当前 Runtime identity 完全一致时，Harness 才能派生 refs-only 的 `runtime-task-snapshot/v1`。v1 仍是只读投影，不反向写入 Repository 或 Runtime。
10. 当前自动生产收尾只发布已经存在的五类 Runtime JSON 声明。Visual Observation、Photoshop 文档、预览或导出资产尚未由各自真实生产者完整接入，真实 ApprovalService 也尚无生产发布调用方；producer ownership 不能被外推成所有 R1～R5 / E1～E2 专业生产者均已接线或已通过真实 Provider + Photoshop 验证。
11. 当前威胁模型把顶层 Renderer 作为受信任 Harness。capability 阻断模型、普通业务调用、subframe、错误窗口、路径或 manifest 的越权，不提供对已攻陷 Renderer / DevTools 的安全隔离。主进程若已完成发布但 IPC 成功响应丢失，当前也没有按已消费 token 取回原成功响应的接口；这是可靠性增强项，不改变不可重放与 fail-closed 边界。

### 2.7 E1 目标绑定与同目标读回

E1 不是“本轮出现过一次写和一次读”就算完成。有效绑定必须同时满足：一个成功的状态变更对应一个 R4 节点；写入与后续读回拥有相同的不透明目标身份；读回序号晚于写入；读回仍对应当前目标且没有歧义。文档名、路径和 Tool payload 不进入目标身份摘要。缺目标、跨目标或无法唯一归因的写入与读回只进入 observation，不形成 E1 完成状态。

### 2.8 Prompt 与 Capability 权责

Prompt 是模型理解、设计判断和结构化声明的输入，不是生产权限系统。每个 Prompt-like 模块必须声明 owner、implementation、authority、scope、activation、现有 Runtime Stage 和 Capability kind。

1. `model_prompt` 和 `hybrid` 只能产生 advisory / declarative 内容，不得授予 Tool 权限、执行 Tool、推进阶段或声明完成。
2. execution / completion 权威只属于 deterministic code；分别由 Agent Runtime / Tool preflight 和 Completion contract / delivery receipt 承担。
3. Global System Prompt 只保留稳定、品类中立的不变量；Skill 方法、Tool semantics 和设计纪律进入 Manifest 激活的 Capability Policy、Knowledge 或 Evaluation。
4. Prompt 不得定义固定生产序列或创建独立 Runtime State。外部 P-01～P-20 只映射到现有 R0-R5/E1-E2，不新建第二 Router 或第三 DAG Runtime。
5. 专业方法只在对应 Skill scope 和阶段按需装载；新增第四个 Skill 不修改 Global Prompt、Agent loop 或 Completion authority。

完整映射和实施顺序见 `docs/design-agent-prompt-capability-governance.md`；代码门禁见 `shared/agent-runtime-v5/prompt-capability-governance.ts`。

### 2.9 主模型与视觉模型的职责

一个 Agent 可以组合多个基础模型，但不能因此产生多个最终裁决中心：

1. 主模型负责目标理解、规划、文案、Tool 调用顺序和最终交付判断，可以是纯文本模型。
2. 视觉模型只在用户图片、Photoshop 画布、素材分析或视觉质量评价需要真实看图时调用，并返回结构化观察。
3. 视觉观察进入主模型上下文；视觉模型本身不获得 Photoshop 执行权、阶段推进权或完成权。
4. 主模型支持视觉且与视觉模型相同时可以直接看图；主模型不支持视觉时由独立视觉模型转述观察；两者均不可用时必须明确尚未取得视觉观察。
5. 模型选择以声明的 `supportsVision` / `supportsToolUse` 能力为准，不根据模型名称、任务品类或固定 provider 白名单赋予能力。名称提示只能用于隔离明显的非对话模型，不能反向授予视觉、Tool 或完成能力。
6. 新模型通过 provider 模型注册表进入候选；主/视觉两角色是当前最小充分配置，不恢复旧的布局/文案/视觉三槽或建立第二套 Worker Runtime。

### 2.10 动态模型用途治理

Provider 返回的“模型列表”不是 Agent 能力清单。动态模型必须先经过统一用途分类：

1. 分类优先读取 Provider 明确用途、输入/输出模态、能力字段和支持方法。
2. 对话、图片生成、Embedding、重排、音频、视频和审核用途必须保持区分；能输入参考图的图片编辑模型不等于能输出视觉理解文本的 VLM。
3. 非对话模型可以保留在统一注册表，供对应 Tool 或后续能力使用，但不得进入主模型、视觉理解模型或聊天快捷候选。
4. UI 过滤不是安全边界；模型选择和 dispatch 在执行前必须再次核验对话用途。
5. 元数据不足且没有明确非对话信号的新模型可以作为待确认对话候选，但必须明示能力元数据不足，并通过真实只读调用确认 Chat、视觉和 Tool 能力。
6. 不在 Agent Runtime 中维护具体型号白名单。保守名称提示只负责降低错误授权风险，长期真相源仍应是 Provider 元数据、人工覆盖或可审计能力探针。

### 2.11 选择、能力、执行、事实与呈现的五层权责

Agent 自主不等于把所有动作同时交给模型，也不等于由 UI、Prompt 和 Runtime 分别猜一次任务状态。生产链必须保持以下单一 owner：

1. **选择事实**归 R0 / `runtime-selected-skill-handoff`。它只回答“谁拥有交付物”，不执行 Skill，也不授予权限。
2. **模型可见能力面**归 Capability Session + Runtime Stage。存在结构化业务 Skill owner 时，E1 首个执行入口只公开该 workflow bridge 与必要 Harness 控制；Skill 已尝试、明确失败或返回后续调整后，才开放已授权原子 Tool 做局部修正。没有 Skill owner 的开放任务继续由 Agent 自主组合 Capability。
3. **真实执行**归 Skill Runtime / Tool execution point。Skill 负责专业方法和内部动作编排；Tool 只负责原子操作；Policy 只裁决安全、权限、读后写与复核纪律，不替 Agent 重新规划。
4. **执行事实**归 Runtime Session、append-only Tool log 和 `AgentExecutionSummary`。是否成功写入、是否观察、是否保存和是否完成只能由结构化工具结果、状态迁移与读回得出；单个 `blocked_*`、异常字符串、assistant prose 或 UI 卡片不得覆盖已经发生的 mutation。
5. **用户呈现**归 User Feedback UX。UI 只能把执行事实翻译为设计阶段、画面判断、阻塞影响和下一步，不能根据错误码自行推断“没有改动画面”，也不能把 Skill 内部原子动作、Harness 控制或调试事件提升为用户步骤。

Workflow-first 是能力面治理，不是品类固定流程：它只在 R0 已经选出结构化 owner 且对应 workflow bridge 真正可用时生效；一次尝试后即恢复动态 ReAct 调整面，不读取任务关键词，也不把原子 Tool 永久隐藏。

## 3. 八个核心子系统

下列子系统共同构成当前 Agent OS，其中一部分属于 Harness，一部分属于 Capability Layer。它们是职责边界，不表示所有逻辑都应写入 Agent 核心。

### 3.1 Intent Control Plane

职责：判断用户到底要聊天、解释、创建设计、修改 Photoshop、保存文件、分析素材，还是需要澄清。

边界：

1. 不能只靠关键词抢路。
2. “保存详情页 PSD”优先是保存动作，不应因为出现“详情页”就执行详情页生成。
3. 模型身份、能力比较、解释性问题应先走对话，不应触发 Photoshop 工具。
4. 模型前确定性直达只允许机械操作，例如保存/关闭文档、明确图层顺序、明确字体替换；参考图复刻、开放式设计、整套电商设计等需要视觉/设计理解的任务必须先经过模型路由或规划判断。
5. 确定性路由可以作为模型选错 skill 时的安全兜底，但不能替代模型理解设计意图。

### 3.2 Context Memory

职责：管理项目状态、当前 Photoshop 文档、历史任务、用户偏好、待办规划和可恢复上下文。

边界：

1. 不能只依赖聊天历史。
2. 中大型需求必须进入 `CurrentTask.md / Intake.md / Plan.md / project-state.json`。
3. 状态必须区分已核实、未核实、风险和规划。

### 3.3 Visual Perception

职责：理解图片、参考图、当前画布、图层位置、元素关系、文本区域、主体区域和视觉层级。

边界：

1. 从扁平图片只能推断一个可编辑重建方案，不能宣称还原原作者真实 PSD 或历史步骤。
2. 没有图片观察、OCR 结果、产品事实或画布读回时，不能编造款式、材质、场景和卖点。
3. 视觉理解结果必须结构化，不能只停留在自然语言描述。

### 3.4 Knowledge And Recipe

职责：提供设计定义、平台规则、版式规则、文案框架、Photoshop recipe、网页来源记录和案例经验。

边界：

1. 当前不启动重型知识图谱。
2. 知识结果只能作为上下文、约束或 recipe 线索，不能直接变成 Photoshop 动作。
3. 外部网页搜索必须保留来源和置信度，不能把未经验证内容写成项目事实。

### 3.5 Design DSL

职责：把用户需求和视觉理解转成可执行的中间表示，例如画布、网格、文本块、图片槽、主体框、样式、recipe 和验收目标。

边界：

1. executor 只消费 DSL 或执行计划，不应该在执行时重新混合大量推理。
2. Grid DSL、智能缩放、文本排版和样式 recipe 都应挂在同一层，避免各场景各写一套规则。
3. 没有 DSL 或执行计划时，不应让模型直接自由调用 Photoshop 工具碰运气。

### 3.6 Photoshop Execution

职责：用 UXP/MCP/Photoshop 工具真实创建、修改、保存、导出可编辑图层。

边界：

1. 高确定性的 Photoshop 内部操作优先走 UXP/MCP，不走鼠标模拟。
2. UXP 面板工具不自动等于 Agent skill；是否开放给 Agent 必须单独定义安全边界。
3. 工具返回成功不等于任务完成，必须进入验收层。
4. 受控脚本化执行只能消费经过校验的 DSL 或 ExecutionPlan，不能让模型自由写 JS、UXP 脚本或 batchPlay descriptor 后直接执行。

### 3.7 Verification And QA

职责：验证工具执行、图层变化、bounds、文本内容、样式、截图相似度、失败原因和人工验收结论。

边界：

1. 当前已有结构和 bounds 验收，但不能等同于审美质量验收。
2. 参考图复刻必须区分骨架复刻、基础样式复刻、截图级相似和设计质量。
3. 任务失败或需复核时，不能用模型最终话术覆盖真实执行摘要。

### 3.8 User Feedback UX

职责：让用户看见真实模型输出、工具调用、执行日志、阻塞原因、验收报告和下一步建议。

边界：

1. 不展示私有 chain-of-thought。
2. 不用硬编码模板伪装模型思考。
3. “正在思考”只用于真实 provider thinking/reasoning 或模型真实输出；系统路由、工具事件和质量检查显示为执行日志或任务报告。

## 4. 最小数据契约

当前先定义契约清单和职责，不要求一次性落地完整 TypeScript schema。

| 契约 | 职责 | 当前状态 |
| --- | --- | --- |
| `UserIntent` | 用户真实任务、动作优先级、是否需要 Photoshop、是否需要澄清 | 部分存在于路由和分类器 |
| `DesignBrief` | 设计目标、受众、场景、风格、尺寸、输出物、禁忌 | 缺统一真相源 |
| `AssetUnderstanding` | 项目素材、图片内容、主体、尺寸、可用性、风险 | 部分存在，未统一 |
| `VisualUnderstanding` | 参考图/画布元素、层级、布局、文本、样式、视觉关系 | 参考图复刻中部分存在 |
| `DesignDSL` | 网格、区域、文本块、图片槽、样式、recipe、约束 | 分散在 Grid、reference、smart-scaling |
| `ExecutionPlan` | 工具调用计划、依赖、降级策略、预期结果与读回 | 分散在 skill executor |
| `ExecutionTrace` | 真实工具调用、结果、错误、耗时、focus、acceptance | 部分存在于 onStep 和 executionSummary |
| `VerificationReport` | 结构验收、bounds、截图、任务级结论、需复核项 | 部分存在于 acceptance 和 QA |
| `ArtifactRepository / ArtifactRef` | 不可变保存正文、二进制、权威 hash 与 lineage；向任务、项目和运行记录提供 refs-only 投影 | 主进程单一 Repository 已接入，真实 producer 覆盖仍不完整 |

## 5. 设计任务生命周期

标准生命周期（不是必须逐项串行执行的固定脚本）：

1. Intake：接收用户需求和素材。
2. Intent：判断意图、动作优先级和是否需要澄清。
3. Context：读取项目、Photoshop 文档、素材和历史任务。
4. Perception：理解图片、画布、图层和文本。
5. Brief：生成设计简报和约束。
6. Plan：生成 DSL 与 Photoshop 执行计划。
7. Execute：调用 UXP/MCP/工具执行。
8. Verify：读取真实 Photoshop 状态并验收。
9. Revise：必要时修正、降级或请求补充。
10. Deliver：输出交付结果、质量结论和剩余风险。

任何业务场景都应该产生这些生命周期所要求的关键状态、观察、运行记录和质量检查，但 Planner 可以按任务复杂度跳过不必要阶段、并行独立阶段、在评价失败后回退，或通过 Skill 提供的阶段约束展开任务图。主图、详情页、SKU 和参考图复刻的差异应由 Capability 声明以及 DesignBrief、DesignDSL、ExecutionPlan 和 VerificationReport 表达，而不是各自绕过总控系统，也不是由通用 Harness 写死顺序。

### 动态计划与任务图治理

1. 简单任务可以直接执行单步计划，不强制创建 DAG。
2. 复杂任务可用 DAG 管理依赖、并行、重试、回退和跨轮续跑；节点状态必须来自真实 Task State、工具结果与读回。
3. Model / Planner 决定任务路径，DAG Runtime 只执行已选路径和状态转换，不替代设计判断。
4. Capability 单一解析、Tool semantics metadata 与 v5 契约生产接线已经形成 `runtime_integrated` bridge；Stage State / Trace 已观察 R1-R5/E1，并对 E2 做质量后置门禁；R3 策略与 R4 动态行动计划均已有模型拥有、Harness 校验的结构化声明；R4 节点也能与本轮真实执行做 Capability 级影子归属、预期结果核对、失败恢复和漂移检测；跨轮续跑建议已绑定新鲜 Context，已完成节点也能通过模型显式映射进入非执行 no-redo 影子观察。但自动防重做、跨进程恢复与真实 E2E 尚未闭环，因此当前仍不新增第三套可执行 DAG Runtime。
5. 首次引入应先运行影子任务图：只记录和校验真实执行 trace，不控制 Photoshop 写入；验证无环、依赖完整、写入可归属、已完成节点不重做后再逐步接管。

### 5.0 当前运行线归一化

为避免把多个阶段性实现误读成多个产品版本，当前统一采用以下裁决口径：

1. `v3` 是当前默认真实执行路径。用户请求实际进入 ChatPanel、DesignAgentEngine、旧 Agent 循环、skill executor、UXP / Photoshop 工具链时，默认仍按 v3 运行线理解。
2. `v5` 是目标治理与契约层。它承载 Skill manifest、ReAct / Reflexion、阶段计划、视觉观察上下文、质量复核和能力边界；视觉观察不承担执行授权，也不等于 v5 已经完整替代 v3 主循环。
3. `bridge` 是过渡适配层。它只负责把 v5 契约、manifest 能力声明和旧实际工具 / 旧 skill 入口接起来，不允许沉淀新的业务策略、隐藏流程或第二套工具注册。
4. `legacy` 是旧入口、旧命名或旧兼容逻辑。它可以保留以避免破坏当前运行，但不应继续扩张；新增能力必须优先说明如何进入 v5 manifest / 契约。
5. 文档和汇报必须明确状态类型：`contract_ready`、`bridge_ready`、`runtime_integrated`、`photoshop_e2e_verified`。不能把前两类写成完整运行时完成。

当前迁移策略：

1. 新增业务能力优先落到 v5 manifest / 契约，避免继续往 v3 executor、ChatPanel 或 legacy bridge 里堆专属分支。
2. 真实 Photoshop 执行仍尊重当前 v3 / legacy 工具链，直到对应能力完成运行时迁移和 E2E 验收。
3. bridge 的退出条件必须可描述：当 v5 runtime 能直接调度同等能力，并通过对应 smoke、typecheck 和真实 ChatPanel / Photoshop 验收后，旧桥接才可以收口。

### 5.0.1 v5 ReAct + Reflexion 运行时闭环

当前 v5 runtime 的治理方向是把生命周期落成可验证契约，而不是在 UI 或业务 executor 里继续堆硬编码脚本。

最小闭环：

1. R0 选择 Skill manifest，并制定阶段计划。
2. ReAct 循环执行：
   - Reason：判断当前阶段目标、上下文缺口、已有观察和下一步动作。
   - Act：调用当前已装载的视觉分析、预览、Photoshop 或交付工具；缺少 schema 时先按需装载，显式 forbidden 始终不可用。
   - Observe：读取工具结果、视觉观察、预览状态或 Photoshop 回读。
   - Evaluate：判断当前阶段目标是否达成；未达成则带约束继续循环。
3. R5 Quality Gate 审核 Preview / Plan / Execution 结果。
4. R5 未通过时，Reflexion 必须回答：为什么失败、哪个阶段的问题、哪些策略应调整、下一轮 ReAct 的约束是什么。
5. Reflexion 结果重新进入 ReAct，而不是作为一段失败话术结束任务。

契约边界：

1. Skill 是任务能力 manifest，描述阶段、输入、读写范围、可用工具和退出条件。
2. Tool 是命名空间化的可执行能力，负责单一动作并返回结构化结果；Tool 不等于 Skill。
3. `available_tools` / `forbidden_tools` 只能列工具能力，不能混入 skill id 或 UI 脚本入口；`available_tools` 是首轮能力种子，不是封闭白名单，`forbidden_tools` 与执行点 Policy 才是硬边界。
4. 视觉观察不足、`structure_only` 等非完整路径必须携带 Reflexion 契约，不能只弹固定卡片或固定文案收口。
5. `structure_only` 是 fallback：不允许 Photoshop 写入，不进入质量通过结论，不承载产品事实或卖点宣称。

当前迁移状态（持续更新，最近 2026-07-13）：

1. v5 详情页 planning gate 已消费 `runtime-reflexion/v0`；blocked / structure_only 路径会先形成 observe / critique / revise，再展示恢复卡片。
2. 旧 `agent-runtime/agent.ts` 已接入可选 `react-reflexion-loop/v0` 桥：模型上下文消费 R0 / ReAct / R5 / Reflexion 契约；非 completed 的质量门禁结果会输出 `quality-gate-reflexion-handoff/v0`。
3. 已新增 `legacy-tool-capability-bridge/v0`：旧实际工具名仍是 `createDocument`、`renderLayout`、`getCanvasSnapshot` 等执行器内工具名；v5 manifest 的 `photoshop.read.*` / `preview.*` / `delivery.*` 是能力边界声明。桥接表只描述能力到旧工具的映射，不改写 manifest。
4. v5 manifest registry 已覆盖核心业务 Skill：`ecommerce.detail_page`、`ecommerce.main_image`、`ecommerce.sku_batch`。旧入口的 `detail-page-design`、`main-image-design`、`sku-batch` 只能作为解析输入映射到 manifest，不能作为 executable tool。
5. `runtime-contract-bundle/v0` 只从显式 task type、Planner 声明的 stable Skill id 或 manifest-owned legacy alias 解析 Skill manifest；legacy 文本路由 hint、用户文本、文档名和设计纪律正则不参与 deterministic manifest 选择。显式未知 task type 保持未解析，不猜相似品类。
6. 生产 `autonomous-agent.executor.ts` 已从同一 manifest 解析结果创建 Capability Session，预签发 `runtime-session-identity/v0`，并向真实 `Agent` 注入 identity / seed、model-visible schemas、`react-reflexion-loop/v0`、stage plan 和 `legacy-tool-capability-bridge/v0`；这些切片状态为 `runtime_integrated`，但不等于 v5 完全替代 v3，也不等于 `photoshop_e2e_verified`。
7. manifest 的 `available_tools` 只提供首轮种子；模型可调用 `requestAgentCapabilities`，在下一 ReAct 轮增量装载 Tool / Skill schema。每个模型轮次最多执行一次装载、总计最多 3 项，只改变模型上下文，不执行 Photoshop、不授予权限；它与 `declareDesignIntent` 都属于 Harness 控制工具，不算环境观察或任务进展。
8. `forbidden_tools` 会保守闭包到共享 legacy provider Tool，不能通过另一条 capability 映射旁路；真实执行仍必须经过 Tool Decision、preflight、HITL、设计纪律、写后读回和质量评价。
9. 当前候选目录为 165 个 Tool / Skill schema、125,386 字符；结构化 generic 首轮为 44 个 schema（含 Harness 元工具）、37,867 字符，约减少 69.8%。全部候选仍可按需发现；141 个 inventory capability 中，25 个来自 grouped legacy Tool bridge、15 个来自 Skill workflow bridge、101 个直接复用 `photoshop-tool-skill.ts` 的 Tool semantics。当前候选面没有虚假 `legacy_unclassified_tool`，但真正未知的未来 Tool 仍显式降级到该 fallback，不能静默消失。
10. 真实 provider 的 Capability 选择使用受双重 API opt-in 保护的聚焦探针：provider 看见生产 generic 首轮 schema，返回的 Tool call 不执行，只有 `requestAgentCapabilities` 的 ID 进入真实 Capability Session 做纯内存激活与最小集合评价。无授权时必须 `guarded_skip`；该探针不等于完整 Agent 多轮选择或设计质量 E2E。
11. ReAct 的职责是推进真实设计动作：理解阶段目标、调用视觉分析 / 预览 / Photoshop / 交付工具、观察工具结果并评估阶段是否达成。Reflexion 的职责只在 R5 或阶段评估失败后生成下一轮改进约束，不能替代 ReAct 直接产出设计。
12. 缺少上游 `intentControlPlane` 时，旧 Agent 不允许自行强制首轮工具调用；普通自然回复不进入“成品补做”循环。
13. 后续工具命名空间迁移必须逐项验证旧工具能力、参数、结果结构和回读语义，不能通过直接改名制造假治理。
14. 旧 `skill-tools.ts` 不是目标形态，只是 `legacy workflow bridge`：注册 Skill 可以作为 ReAct 行动入口被旧 Agent 调用，但它不是原子 Tool，调用结果必须回到 `agent-react-observation/v0`，再由 Agent 继续 Observe / Evaluate / Quality Gate。
15. 对确认执行类请求（例如已确认 SKU 组合后的生产），允许定位到对应 Skill 工作流桥，但不能绕过 Agent 直接把 `execute_skill` 当最终闭环；必须保留 ReAct 与验收回流。
16. `runtime-session/v0` 是 manifest-bound 生产路径的运行身份和阶段事实 owner：同一任务保持一个 sessionId，Reflexion generation 单调递增，parentRunId 指向上一代；Stage State 由运行中 reducer 推进，不在收尾从 Trace 重建。
17. `runtime-stage-state/v0` 只记录 current stage、缺失的阶段条件与 transition，不读取任务文本、不调度 Tool、不授予权限，也不自行铸造 DesignVerdict 或任务成功；TaskCompletion 是独立结果层，但与 Session 未完成冲突的 `completed` 必须降为 `needs_review`。
18. `runtime-stage-trace/v0` 是 append-only observation ledger。开工观察、执行前契约、R1/R3/R4 模型声明、真实 Tool result、读回和质量通过后的交付事实可以被记录，但只有当前阶段对应的结构化 evaluation 才能推进 State；普通 Tool success、assistant content、UI 卡片和越序 observation 都不能推进。
19. 状态变更 Tool 只有在当前阶段进入 E1 后才能 dispatch；写入成功只记录一次 mutation，后续同目标读回才可结束 E1。R5 只消费唯一 `DesignVerdict`，E2 还要求 R5 passed 和真实 delivery receipt，final response 不能补造交付。
20. Runtime Session 完整 State / Trace 与 Planning Seed 作为活动承接容器只在当前进程有界保留；其中已经过 Harness 校验的 Brief / Strategy / Action Plan 可以在收尾阶段由 Artifact Repository 另行发布为不可变正文。Run Record 与 Resume 仍只保存匹配预签发 runId 的 digest 或 Repository ref，不能因旧档案或 Artifact 较新就自动继承活动 Session、恢复完整 Planning Seed 或反向补造 ready 声明。归档的 `WorkflowRun` / orchestrator 不进入生产路径。
   - `runtime-planning-context-seed/v0` 的承接矩阵按 Stage Plan 顺序确定：只承接 Reflexion target 之前的 ready 声明；target 及下游 snapshot、观察记录和声明在新 generation 开始时失效。回退 R4 不能复用旧 Plan；回退 E1 可以承接 Plan，但其 `shadowOnly / executable=false / schedulerAuthority=false` 边界不变。
   - shadow reconciliation 继续把 missing stage、out-of-order、trace-backed / derived / unbacked transition 如实报告；这些缺口不能被默认完成或固定流程掩盖。R3 与 R4 现在都必须来自各自的结构化模型声明；未声明时继续保持 `unobserved`，不能用普通 Tool call 或自然语言补齐。R4 仍不拥有 Tool 调度权。
21. Stage Trace 首次接入后暴露 R3 缺少结构化策略声明；该缺口随后由模型拥有的运行时策略声明桥治理，不能再回退到解析 assistant prose 或 Harness 默认策略。
22. R3 运行时策略声明复用 immutable CreativeStrategy 的通用字段类型，但 `declareDesignStrategy` 控制调用本身不是 Artifact 发布；只有 Harness 收尾通过唯一 Artifact Repository 发布后，声明正文才取得 Repository ref。模型和调用方仍禁止伪造 artifactId/contentHash/contextSnapshotRef，也不得把品类专属 contentModules 强加给通用设计。
23. `declareDesignStrategy` 是模型拥有内容、Harness 只校验的控制工具。它的 `contextRefs` 由当轮真实输入、manifest、观察、知识、写入和交付状态动态开放，并使用语义引用而非具体 Tool 名；声明不执行 Photoshop、不授予权限、不算 E1/完成/质量通过。
24. `runtime-action-plan-declaration/v0` 是模型拥有内容、Harness 只校验的 R4 控制契约。它要求 ready 的 R3 策略，步骤只能引用当前可用 `contextRefs`、`expectedOutcomes` 和 Capability Resolution，可选 DSL 直接复用 `LayoutRegion` / `ElementPlan` 与 0..1 归一化布局；禁止 legacy Tool 名、操作参数、图层标识和像素坐标。
25. 未激活但可发现的 Capability 只使计划进入 `needs_capability`；计划声明器不得自动激活能力。模型必须显式调用 `requestAgentCapabilities`，待 Resolution 更新后重新提交计划。
26. 普通可执行 Tool call 不再充当 R4 计划声明；只有合法 `action_plan_declaration` 可以形成 R4 trace。R4 声明不经过外部 Tool executor，不调度依赖、不授予权限、不算 E1、任务完成或质量通过。
27. 完整 R4 声明在当前结果中有界保留，并可在 Harness 收尾时作为 Runtime Action Plan 正文发布到唯一 Artifact Repository；execution summary、Run Record、Resume 与 RuntimeTaskSnapshot 仍只保存 digest 或严格 Repository ref，不复制声明正文，也不从 Artifact 反向取得调度权。重型 schema / validator 在 R3 ready 后按需加载，避免所有对话启动都承担完整计划校验成本。
28. `runtime-action-plan-reconciliation/v0` 使用 Capability Session 现有 inventory，把 ready 计划声明后的真实 Tool result 映射为当前已激活 Capability 与 `observedOutcomes`；不建立第二套 registry，不保存 Tool 名、参数或结果载荷。
29. 节点归属必须同时满足依赖已完成和 Capability 唯一匹配。多义、依赖越序、计划外 / 未映射动作与节点完成后重复分别保留为 ambiguous、dependency_blocked、unmatched、repeat_after_completion，Harness 不猜归属。
30. 节点 `completed` 只表示全部 `expectedOutcomes` 已在结构化运行观察中出现；对账器不解释 completionCriteria 自然语言、不执行 failurePolicy，也不把节点完成升级为 R5 质量或 E2 交付。
31. 失败后恢复只在后续真实成功事件到达时记录 recovered；这不代表 Harness 自动重试。R3 或 R4 重声明会开启新对账代次，旧观察不得污染新策略 / 计划。
32. 完整 journal、step state 和 attribution 只在当前结果有界保留；run record / resume 保存 digest 和建议核实的 step id。续跑建议不是调度命令，必须先用当前只读探针核实现状。
33. `runtime-resume-context-anchor/v0` 只从最后一次成功 Photoshop 写入之后的完整结构读回生成文档指纹，并独立记录最新 Design Project State 指纹。写前观察、局部子树和 summary-only 文档信息不能伪造强锚点；原始图层、名称、路径、图片和 Tool 载荷不得持久化。
34. 跨轮恢复采用两阶段注入：先选择旧档案但不暴露跳过建议，再执行锚点同类只读探针并形成 `verified / mismatch / insufficient_context / probe_failed`，最后生成 resume brief。只有 verified 可以把旧节点描述为已核实建议，其余状态全部作废旧跳过依据。
35. freshness 只评价旧档案记录与当前只读探针是否仍一致；任务相关性仍由 Model 判断。它不阻断当前任务、不执行写入、不授予权限、不自动跳过、恢复、重试或调度，也不计入任务进展、R5 或 E2。
36. freshness 必须区分旧计划中已经 completed 的节点与 pending resume 节点；只有前者可以成为 no-redo 候选。长期摘要只允许保留 stepId、kind、实际 Capability 与 `observedOutcomes`，不保存 goal prose、Tool 名、参数或结果。
37. 当前 R4 step 只有通过模型显式 `resumeMapping` 才能声明与旧 completed 节点等价，并必须选择 `reuse_completed_step` 或 `redo_required`。映射必须一对一且引用 freshness verified id；Harness 不使用文本、品类、Tool 或 Capability 相似度补造关系。
38. `runtime-action-plan-no-redo-shadow/v0` 只把复用映射与当前真实 reconciliation attempts 对账：无 attempt 是复用候选，发生 attempt 是 repeat_observed，redo_required 单独记录为 intentional redo。它不改变当前节点依赖、状态或执行结果。
39. 完整 no-redo decision 只保留在当前结果；execution summary、run record 和下一轮摘要只保存 digest。R3 / R4 重声明必须开启新代次，旧映射与旧 observation 不得污染新计划。
40. 真实模型映射质量必须用独立 `agent-no-redo-provider-probe/v0` 评价，不得从 provider prose 猜测。最低 verdict 集应覆盖正确复用、正确重做、正确无映射、遗漏、错误等价、错误节点、错误策略、过度映射、非法声明与 unsafe Tool。
41. provider 探针只暴露生产 R4 声明 schema，返回调用只进入生产 validator，不进入 Agent executor。报告只能保存 mapping id / policy、issue code 与计数；Prompt、完整计划、arguments、thinking、API key 和路径不得导出。
42. 所有真实 provider 探针复用同一双重 API opt-in、隔离 userData / 端口与 fake Photoshop 边界。默认必须 guarded skip；未授权 skip 只能证明安全边界，不能证明模型行为。
43. 当前状态更新为 `probe_ready_real_provider_opt_in_pending`：offline evaluator、生产 schema 自测和 guarded skip 已通过，但真实 provider 三样本尚未运行。没有真实 mapping 正确率和误判率前，自动跳过与依赖图仍不是可执行 DAG，不能接管 Photoshop 调度。
44. Capability Layer 的六类引用必须经过 `runtime-capability-reference-resolution/v0` 核验。manifest 中出现字符串只代表 requested，只有类型匹配且存在真实 provider identity 才能进入 resolved；缺失与类型错配分别形成稳定 issue，并使 manifest Resolution 诚实降级为 partial。
45. Action inventory 继续只承载可暴露 schema 的 Tool 与迁移期 Skill bridge；Knowledge、Memory、Evaluation、Policy 不得为了进入 Capability Layer 被包装成虚假 Tool。Knowledge 可以由现有只读知识 Tool 提供，但 provider 身份必须从共享 Tool 语义和真实候选 schema 推导。
46. 非执行 provider 的稳定 id 必须由真实实现共同引用。Design Project State、DesignVerdict、Tool Decision、Design Discipline 与 Tool Safety 不允许由 Resolver 维护第二份字符串真相源；扩展 provider 只能增加身份元数据，不能单独注入模型 Tool schema。
47. provider-backed 只证明能力来源可追溯，不证明知识已读取、Memory 已命中、Skill 已执行、Policy 已触发、Evaluation 已通过或设计质量完成。Prompt 与运行结果必须保留这一区分，不得把 reference resolution 当作任务进展、R5 或 E2。
48. `rubrics/main-image.v1`、`rubrics/detail-page.v1`、`rubrics/sku-batch.v1` 曾因没有真实 provider 而保持 partial；该缺口已由独立 Evaluation Profile provider 治理，不能回退为空 rubric、默认分数或假成功 provider。
49. `design-evaluation-profile/v0` 是 Skill 的可插拔评价能力契约。它声明能力目标、适用 Skill / task type、共享断言引用、结构化 `checks`、required 检查项、通过阈值与最低覆盖率；Profile 不能包含 Tool 执行、Workflow 选择或独立最终 verdict。
50. 主图、详情页和 SKU 可以拥有不同 Profile，但差异只能留在 Profile 数据和业务 result adapter。Agent 核心只消费 runtime bundle 显式给出的 Profile，不得根据 task text、正则、品类名或 legacy route hint 选择评价标准。
51. Profile 必须复用共享 `DesignAssertion / DesignScorecard`，并继续通过唯一 `DesignVerdict` 串联任务完成契约。Profile result / digest 不是 R5 最终裁决；缺 required check 为 insufficient，检查明确失败才 failed，needs-review 不能升级 passed。
52. Evaluation provider identity 必须携带 Skill / task scope；真实 provider 被错误 manifest 引用时，Capability Resolution 必须产生 `capability_reference_scope_mismatch`，不能仅因 ID 和 kind 存在就 resolved。
53. 默认 Agent 可以自动形成写后结构读回和实际视觉判断；主图 QA、详情页跨屏 /落位、SKU 变体 /真实性 /导出 /一致性必须由独立业务适配器提供结构化检查状态。Tool 调用成功不等于评价 check passed。
54. 三个 Profile provider 与业务 result adapter 均已 runtime integrated，业务 manifest references 已 resolved；真实视觉模型判断和 Photoshop E2E 尚未验证。缺版本契约时 Profile 诚实返回 insufficient，不得追加质量通过或 E2 交付状态。
55. `design-evaluation-result-adapter/v0` 是 Capability Layer 的只读边界：Profile 固定绑定唯一 Skill bridge source，只接受该 source 返回的版本化业务契约；不得用 task text、正则、route hint 或任意 `result.success` 选择或生成检查结果。
56. 业务检查记录必须晚于本轮最后一次相关 mutation。若适配来源早于后续成功 Photoshop write，旧检查只能 needs_review，不能继续通过或失败当前画面；adapter 不调度补拍、不自动重跑 Skill。
57. 适配器不能抬高来源可靠程度：详情页 screen plan 曾没有逐屏商品事实 ref，因此只能 needs_review；该缺口已由 `detail-page-content-verification/v0` 治理。SKU 文件 /像素读回仍不能替代商品真实性和视觉一致性，二者只有明确 human review approved 才能 passed。
58. Adapter 只输出固定 verification key、`passed / failed / needs_review` 与安全 `verificationRef`，不保存原始业务 payload、路径、图片、Prompt 或 Tool arguments；完整业务结果仍由原契约 owner 管理。
59. Adapter result 不拥有最终 verdict，也不构成新的 QA 引擎。所有业务检查记录必须继续进入 manifest-selected Profile、共享 `DesignScorecard` 和唯一 `DesignVerdict`。
60. 详情页事实引用必须前向传递：事实目录签发稳定 ref，ref 随 `DetailScreenAgentDecision → DetailScreenPlan → FillPlan → execution result` 到达收尾；Harness 不得在收尾阶段按文案、品类或文件名反推来源。
61. `copywriting.basis` 不是天然事实。只有 basis 或主信息严格匹配 Project State productFacts / sellingPoints 或脱敏视觉 `sellingPointObservations` 时，才允许签发 ref；未知和路径式 ref fail closed。
62. `detail-page-content-verification/v0` passed 要求每个实际执行屏同时满足：屏决策完成、填充成功、实际文案存在、ref 属于当前事实目录、文案严格文本锚定引用事实。合法 ref 与自由改写无法严格锚定时只能 needs_review，不调用模型做语义补判。
63. Project Visual Insight 可以保存有界 `sellingPointObservations`，但必须继续移除 raw image、base64 和原始视觉载荷；Evaluation verification record 只保存 ref / source kind /计数，不能复制事实 statement 或素材路径。
64. 逐屏内容检查 passed 只证明事实锚定链完整，不证明商品事实本身已由权威来源确认，也不证明版式、审美、Photoshop 结果或 E2 交付通过。
65. 人工复核必须绑定明确的版本化 subject。SKU 使用 `sku-human-review-target/v0` 从匿名项目身份和每个导出文件的内容 hash 形成批次；文件名、导出成功、像素指标或自由文本摘要不能独立证明复核对象。
66. 缺项目身份、读回未就绪、预期文件缺 hash 或文件名不能一一对应时，Harness 必须阻止复核卡创建；不得退回文件名 fingerprint、时间戳或“最近一次复核”。
67. `human-review-record/v0` 是 Memory 审计输入，不是质量裁决。绑定 subject 的记录必须携带本地完整性 fingerprint，载入时发现记录内容变化要 fail closed；该 fingerprint 不得表述为密码学签名或远端身份认证。
68. SKU 人工复核只能由用户在专用交互卡确定性提交。写回不能重入模型、调用 Photoshop、触发发布、授予执行权或直接改变任务完成状态；模型不能代替复核人生成 approved。
69. `sku-human-review-binding/v0` 必须用当前重新计算的 project / output subject 核验记录 freshness。相同内容可跨轮恢复，任一输出 hash 变化后旧记录只能 stale，篡改或结构非法记录只能 invalid。
70. SKU Profile 的商品真实性与视觉一致性只有 fresh approved、subject/project matched 且 record integrity verified 时才能接收 `human_review` 检查记录；即时 intake approved、旧台账意见或读回成功仍不得通过，最终裁决继续归唯一 `DesignVerdict`。
71. Project State 的商品事实必须使用 `design-project-fact/v0` 表达来源和确认状态。claim 至少区分 product fact / selling point；来源至少区分用户陈述、项目素材观察、产品文档、品牌规范、市场研究、Agent 推断与 legacy unattributed。
72. `productFacts / sellingPoints` 字符串字段只保留旧项目兼容语义。读取时必须映射为 `legacy_unattributed + unverified`，不得因旧状态存在、历史使用频繁或文案严格匹配就提升为 confirmed。
73. Agent、队友和外部 MCP 只能通过 `upsertFacts` 写候选，并由执行点固定签发 `agent_proposal`。普通 `set` 不得覆盖 factRecords；模型参数中的 user confirmed 或 review authority 必须被忽略 /降权。
74. 用户确认必须通过专用事实复核卡确定性写入。提交前要核对匿名项目 fingerprint、事实集合 fingerprint 和卡片内容；卡片被修改、项目错误或 facts 已变化时必须拒绝，不重入模型或触发 Photoshop。
75. confirmed / rejected / superseded 事实记录必须保留本地 integrity fingerprint；不匹配时降回 unverified。该机制只检测意外修改，不是密码学签名，也不对抗能重算本地 hash 的恶意用户。
76. Harness 不得用语义相似度推断事实冲突或替代关系。相同规范化 statement 可以合并来源；矛盾、驳回和取代必须由用户或可信系统按稳定 fact ID 显式提交。
77. 业务 Skill 可以使用 unverified 候选帮助规划，但 Evaluation passed 只能由 `user_confirmed / source_supported` 或当前可核验的直接视觉观察支撑。事实确认只证明来源条件，不拥有 Photoshop 权限、任务完成或最终 DesignVerdict。
78. 项目 /品牌规则必须使用 `design-project-rule/v0` 表达规则类型、statement、适用 task / deliverable / channel、强制等级、来源、确认状态、生命周期和复核审计。旧 `brandStyle` 只保留 `legacy_brand_style + unverified + guidance` 兼容语义。
79. 规则强制等级只允许 `guidance / quality_gate / approval_required`。它们分别表示设计参考、质量声明门禁和交付前审批；无论哪一级都不得授予 Photoshop、文件、发布或外部动作权限。
80. Agent、队友和外部 MCP 只能通过 `upsertRules` 写候选，并由执行点固定签发 `agent_proposal`。普通 `set` 不得覆盖 ruleRecords；Design Memory 中的 `project_rule / brand_preference` 只是可检索来源，未经当前项目复核不能自动升级为 Policy。
81. 用户规则确认必须通过专用 `design_project_rule_review` 卡确定性写入。提交前必须核验匿名项目 fingerprint 与当前待复核规则集合 fingerprint；卡片或状态变化后拒绝旧卡，不重入模型或 Photoshop。
82. confirmed / rejected / superseded / revoked 规则必须保留本地 integrity fingerprint；不匹配时降回 unverified。规则可按稳定 rule ID 显式取代或撤销，不允许通过覆盖自由文本隐式丢失历史。
83. Harness 不得仅凭 rule kind 或自然语言相似度猜冲突。只有规则显式声明同一 `constraintKey`、适用范围相同且 statement 不同，才形成结构化冲突；未声明 constraintKey 的兼容规则不得被误判为互斥。
84. 未确认的 quality_gate / approval_required 候选会使质量声明保持 needs_review；已确认冲突会阻止质量通过声明；已确认 approval_required 会要求交付前审批。三者都只产生非执行 Policy 判断。
85. `design-project-rule-policy/v0` 必须显式携带 `doesNotGrantToolPermission=true`，并与 Tool 决策 /安全 Policy 分离。品牌规则可以约束输出，却不能成为绕过执行授权、读后写纪律或用户审批的路径。
86. 每条进入运行时的设计知识必须绑定 `design-knowledge-governance/v0`：至少包含正文内容 fingerprint、source revision、provenance、lifecycle、retrievedAt、可选 expiresAt / supersededBy 和本地 integrity fingerprint。
87. Knowledge provider 身份可解析只证明来源入口存在，不证明本轮读取了知识正文。真正使用知识时必须产生 `design-knowledge-usage-snapshot/v0`，按 binding 记录内容 fingerprint、source revision、freshness、allowedUses 与有界计数。
88. `current / stale / withdrawn / superseded / invalid / legacy_unversioned` 必须保持可区分。只有 current 且允许 `prompt_context` 的知识可进入 Planner 或模型上下文；stale / legacy 只能待复核，withdrawn / superseded / invalid 必须阻断。
89. bundled curated、人工复核 Memory、本地 Eagle snapshot、实时外部搜索和外部 snapshot 必须保留不同 provenance；sourceRank 只用于同等可用知识的排序，不能覆盖版本、新鲜度、撤回或完整性判断。
90. 外部趋势、市场洞察和平台规范必须有有限有效期；普通网页 /参考案例也必须形成检索快照并设置有效期。重新检索产生新 binding，不得无期限复用旧摘要。
91. 知识正文或 governance lifecycle / expiry 被本地修改而 fingerprint / integrity 不匹配时必须标为 invalid；本地 fingerprint 仍不是密码学签名，也不对抗能重算 hash 的恶意用户。
92. 旧的无版本 `DesignKnowledgeResult` 保留读取兼容，但统一归为 `legacy_unversioned`，不得继续作为 prompt_context。兼容不等于静默升级；必须经当前 provider 重新检索或显式治理后才能使用。
93. Knowledge usage snapshot 只保留 digest、来源类型、版本与状态，不复制正文、URL 查询参数、用户检索词或本地路径，并固定声明 `doesNotGrantToolPermission=true`、`doesNotProveQuality=true`。
94. 主图 /详情页方法论、通用设计原则等静态 Knowledge Tool 也必须返回相同 governance binding 与 usage snapshot；“内置知识”不能成为绕过版本治理的例外。
95. 主图、详情页、SKU 等业务 Skill 的 R1 必须由模型通过 `runtime-design-brief-declaration/v0` 显式声明；Harness 只按当前 manifest 的 required / optional inputs 校验覆盖，不得从任务文本、品类、文件名或默认模板反推输入已提供。
96. Brief ready 前只允许读取项目上下文、取得视觉 /结构观察和检索 Knowledge。Photoshop 写入、保存导出、外部生成和业务 workflow bridge 必须在执行点 fail closed；读取成功、Capability 可用或普通 Tool batch 都不能代替 R1。
97. R1 Brief 只描述目标、交付、输入覆盖与约束，不生成 R3 策略、R4 行动计划或 Photoshop 动作，也不授予 Tool 权限、自动装载 Capability、计算任务进度或证明设计质量。
98. R3 只能在当前 Brief ready 后声明，R4 只能在当前 R3 ready 后声明。Brief 重申必须使旧 R3 / R4 与对应执行观察失效，避免任务目标变化后继续消费旧计划。
99. 完整 Brief 只允许保留在本轮有界运行结果；跨轮 run record 与 resume 只能持久化 digest、输入状态计数和安全 `contextRefs`，不得复制完整输入、素材路径、图片或敏感载荷。
100. 品类 Brief / intake 不得成为第二套 Agent R1 真相源。迁移时必须先接通 Harness-owned Brief 上下文和真实消费者，再删除旧入口，并用业务回归证明不是以能力退化换取架构整洁。
101. Harness 在执行边界统一生成 R1 digest，并把 declaration、digest 和当前 manifest required inputs 传给被选择的 Skill；子 Skill 继承同一上下文。业务 executor 不得各自复制 validator 或 digest 算法。
102. 项目素材理解必须与任务 Brief 分离。`project-product-understanding/v1` 只整理结构化 asset role 与已有视觉观察，作为只读项目上下文，不读取任务文本，也不授予执行权。
103. 通用 Product Understanding 不得推断品类、组合规则、买家问题、卖点策略或设计方向；这些内容分别归用户 /项目事实、Skill Knowledge、模型 R3 Strategy 与 R4 Plan。
104. Planner 可以消费 product type、material、scene、style tag、`sellingPointObservations` 和 visual summary，但不能把观察字段升级成已确认商品事实或确定性设计方案。开放式设计 follow-up 仍由模型理解与动态规划。
105. “存在 live runner”不等于系统级 E2E。主图、详情页、SKU 必须分别完成真实 Agent、真实 Provider、manifest stage plan、被选 Skill bridge、Photoshop、写后读回、Evaluation 和 R4 交付检查。
106. 系统级 E2E readiness 必须 fail closed：缺任一关键运行结果或质量检查只能是 `partial_runner`，不得由脚本名称、单次导出、Tool success 或人工印象升级为 ready。
107. 实机验收默认只读。Photoshop 写入至少需要任务级 live 授权与一次性文档 /输出授权；CLI 参数本身不能成为唯一写权限来源。
108. Provider 可达与 Photoshop Bridge 可达必须分开记录。模型可用但 8768 不可达时，只能报告基础设施部分就绪，不得运行或声称 Photoshop E2E。
109. 三类业务 Skill 的系统路径验证必须复用生产 Agent、结构化 Manifest Resolver、Capability Session 和 workflow bridge；不得用测试专用第二套 orchestrator 证明生产拓扑。
110. fixture 模型和 fixture executor 可以证明 R1 / R3 / R4 与被选 Skill 的控制流，但 Evaluation 必须保持未通过，且报告必须明确 `executesPhotoshop=false`、`claimsLiveE2E=false`、`claimsDesignQuality=false`。
111. 治理目标不是通过升级模型掩盖 Harness 缺陷。模型超时、漏字段或重复调用应先检查能力面、阶段可见性、schema 反馈和停机纪律；更换模型只能作为独立 Provider 选择，不得成为架构修复。
112. R1 / R3 只暴露跨品类只读上下文 Capability 的首选 provider；业务 Skill、Photoshop 写入和交付 schema 必须在 R4 ready 后才进入模型可见面。若 R0 已选出可执行 workflow owner，E1 首次只公开该 Skill bridge 与 Harness 控制，Skill 尝试后才恢复当前 Manifest 已授权的原子调整能力。
113. 阶段可见性按 Capability id、runtime state 和结构化 selected-Skill owner 决定，不读取用户任务文本、不匹配主图 /详情页 /SKU 关键词，也不形成永久 Tool 白名单。没有 owner 的开放任务保持通用 ReAct；有 owner 的任务也只收窄首次执行入口，不锁死后续调整。
114. 无效 Harness control declaration 只能进行有界、同工具 schema 修复。Harness 不删除未知字段、不补造缺失上下文引用或预期结果、不代写模型内容；修复超限必须停止并报告。
115. 模型路由已选择、但因 Skill declaration 的 `modelDirectExecution=forbidden` 必须转入 autonomous ReAct 的 business-workflow，必须通过 `runtime-selected-skill-handoff/v0` 保留 R0 选择事实。把直接执行决策置空时不得同时丢失 Skill identity。
116. selected-Skill handoff 只允许来自结构化模型选择和 Skill declaration，不得从任务文本、deterministic hint、文件名或品类正则补造；它不执行 Skill、不授予 Tool 权限，也不证明 R0 之后任何阶段通过。
117. 一旦存在结构化 Skill / task type 选择，生产 Capability runtime 必须解析到唯一 Manifest；缺失、损坏或互相冲突时必须在模型和 Photoshop 调用前 `selected_manifest_missing` fail closed，禁止静默退回 generic broad discovery。没有结构化选择的开放任务仍可保持通用能力发现。
118. “本轮是否改动画面或文件”必须来自成功的 `photoshop_write | save_export` 事实计数；UI、状态码映射和失败清洗不得把后续阻断改写为“整轮没有改动”。
119. Workflow Skill 内部 Tool 调用保留在 Skill 结果、Tool log 和验收记录中，但默认不提升为用户顶层步骤；用户过程只呈现 Skill 阶段、必要观察、质量结论与阻塞影响。
120. Runtime 收口异常不得覆盖已经产生的执行结果。若无法安全进入下一代 Reflexion，应保留当前 Tool result、mutation 与读回记录，停止继续写入并要求复核，而不是返回“本轮不会改动画面”或内部错误码。

### 5.1 A0-A9 逻辑角色映射

用户提供的 A0-A9 架构作为 Design Agent OS 的逻辑角色视角保留，不等于当前必须拆成 10 个独立运行时 Agent。当前实现可以把多个角色合并在同一编排器、模型调用、skill executor 或共享 service 中，但输出的观察、决策、运行记录和质量结论必须能回到下面的职责边界。

| 逻辑角色 | 对应 OS 阶段 | 当前定位 |
| --- | --- | --- |
| A0 总控编排 | Intent / Context / Plan | 判断任务、选择能力、控制阶段和退回，不直接写 Photoshop。 |
| A1 需求理解 | Intake / Brief | 把模糊需求转成 DesignBrief、缺失问题和安全边界。 |
| A2 产品 / 素材理解 | Context / Perception | 理解素材、产品事实、图片质量和可用性，不直接修图。 |
| A3 用户 / 市场洞察 | Knowledge / Brief | 收集用户痛点、购买疑虑和外部产品 / 市场信息，不等于竞品照抄。 |
| A4 卖点 / 文案策略 | Brief / Knowledge | 生成卖点层级和可上图文案，必须基于事实和风险检查。 |
| A5 参考 / 视觉方向 | Perception / Knowledge | 拆解参考、Visual DNA、色彩、字体和构图方向，不直接照抄。 |
| A6 设计规划 | DesignDSL / Plan | 生成画布结构、信息层级、图片槽、文本区和执行任务清单。 |
| A7 执行生产 | Execute | 消费 ExecutionPlan，通过受控工具生成预览或 Photoshop 落地。 |
| A8 审核优化 | Verify / Revise | 检查需求、视觉层级、文案风险、可落地性和 QA 结果。 |
| A9 交付 / 复盘 | Deliver / Context Memory | 整理交付、记录失败原因、沉淀 learnings，不伪造导出或学习。 |

执行约束：

1. A0-A9 是职责拆分，不是 UI 标签，也不应直接显示给普通用户。
2. 任一角色都不能绕过 Tool Registry、Photoshop Execution 和 Verification。
3. 角色输出必须进入共享数据契约，不能每个模块私存一套互不兼容状态。
4. 多 Agent 运行时可以作为后续演进，但不能替代当前最小控制面、工具边界和验收闭环。

### 5.1.1 A0-A9 与 v3 运行时载体映射（2026-06-11）

概念蓝图全文见 `docs/design-agent-blueprint-a0-a9.md`（用户脑图导入）。蓝图结论：长期 1 总控 + 9 专业共 10 个逻辑 Agent；第一阶段合并为 6 个执行模块；全体角色共同读写 Design Project State；审核按退回规则路由到对应角色。

当前 v3 运行时（模型自主工具循环为默认路径，design-teams 为运行时子 Agent 团队）对蓝图第一阶段 6 模块的承载状态：

| 蓝图第一阶段模块 | 逻辑角色 | 运行时载体 | 状态 |
| --- | --- | --- | --- |
| 模块1 总控 / 需求 | A0+A1 | 主自主循环（编排、brief 复述行为） | 部分：缺结构化 DesignBrief 沉淀与缺失信息清单工具 |
| 模块2 商品 / 市场分析 | A2+A3 | scene-analyst 队友 + 素材分析工具 | 部分：缺 A3 市场洞察运行时角色 |
| 模块3 卖点 / 文案 | A4 | 散落在 detail-page 技能内部 | 缺专属运行时角色 |
| 模块4 参考 / 规划 | A5+A6 | design-strategist 队友 + 参考搜索 / 布局复刻技能 | 基本覆盖 |
| 模块5 执行生产 | A7 | executor 队友 + 业务技能执行器 | 覆盖 |
| 模块6 审核 / 交付 | A8+A9 | critic 队友（结构化裁决 verdict） | 部分：缺 A9 交付复盘与 learnings 反哺 |

已落地的运行时机制：团队共享黑板（DesignTeamWorkspace，单次运行内）、持久化 Design Project State（`<项目>/.designecho/design-state.json`，主循环摘要注入与队友产出写穿）、角色感知模型选择（分析 / 评审角色优先视觉模型）、保序并行执行（只读角色可并发）、循环内视觉观察回传、评审驱动修订循环（runDesignTeamPipeline）。

蓝图对照下的已知缺口（实现规划见 `docs/design-project-state-and-design-skills-plan.md`）：

1. 审核退回路由只回 executor，未按蓝图退回规则路由到对应角色。
2. A3 市场洞察、A4 卖点 / 文案策略缺运行时角色。
3. A9 复盘与 learnings 反哺未实现；Design Project State 已能保存共享事实与版本，但不等于自动学习闭环完成。

实现红线（与第 5.3 节边界一致）：A0 的信息完整度检查、退回判断等蓝图逻辑必须实现为模型可调用的工具与共享数据契约，不允许实现为绕过模型的代码闸门或关键词路由；技能知识不渗透进自主循环执行器。

### 5.2 横向能力层映射

用户提供的 K0 / M0 / S0 / T0 / R0 / P0 作为横向能力层保留，并映射到现有 OS 子系统：

| 横向能力 | 对应 OS 子系统 | 边界 |
| --- | --- | --- |
| K0 Design Knowledge Agent | Knowledge And Recipe / Visual Perception | 提供参考理解、设计原则、recipe 和来源记录；知识不能直接变成 Photoshop 动作。 |
| M0 Memory / Learning Manager | Context Memory | 管理用户偏好、品牌规则、项目复盘和 learnings；旧记忆不能覆盖当前用户指令和项目事实。 |
| S0 Skill Registry / Skill Runner | Design DSL / Plan / Execute | 加载和校验 skill 契约；Skill 是任务能力，不是工具，也不是 UI 页面。 |
| T0 Tool Registry / Permission Router | Photoshop Execution / Verification | 管理可调用动作、副作用、权限、工具结果和读回；Tool 只执行动作，不做设计判断。 |
| R0 Reference Source Router | Knowledge And Recipe | 统一 Eagle、上传参考、Brand Kit、历史案例和外部信息来源；必须标记来源并防止照抄。 |
| P0 Photoshop Execution Router | Photoshop Execution | 判断预览、沙盒、当前文档写入和 UXP 桥接方式；默认不修改当前 PSD。 |

### 5.3 Agent / Skill / Knowledge / Tool / UXP / Photoshop 边界

1. Agent 负责理解、判断、规划、选择和审核，不直接执行 Photoshop API，也不把工具返回文本伪装成自然回复。
2. Skill 负责定义业务任务能力、输入输出、默认工作流、可用工具、禁用工具和验收口径；Skill 不等于 Tool。
3. Knowledge 负责提供设计原则、参考拆解、外部信息、recipe 和来源记录；Knowledge 只能作为上下文或约束，不直接授权写入。
4. Tool 负责执行单一可审计动作，必须声明输入、输出、副作用、风险等级、失败状态和读回要求；Tool 不做审美判断。
5. UXP 是 Photoshop 轻量桥接层，负责安全执行受控工具和回传结果；UXP 面板工具不自动等于 Agent skill。
6. Photoshop 是真实 PSD、可编辑图层、沙盒落地和最终精修环境；高频试错应优先在桌面端预览或计划层完成。
7. Eagle 是视觉资产和参考库来源，不是 Agent 大脑；默认只读，不默认全量扫描或写回。

### 5.4 UI 整合边界

当前不采用 `design_agent_studio_rebuild_pack_v4` 的 clean-start UI 路线，不删除现有工作台，也不把 schema/debug 页面重新作为产品主界面。

后续 UI 推进原则：

1. 保持当前 DesignEcho 工作台结构，在现有 ChatPanel、素材、运行详情、QA、设置和任务流基础上逐步收口。
2. UI 可以产品化呈现 Agent 过程、工具摘要、验收报告和阻塞原因，但不能暴露 raw tool JSON、内部路由、skill id 或开发调试字段。
3. 技术诊断保留在 Developer Debug / 诊断模式，普通用户界面只显示任务语言、必要观察、质量结论和交付结果。
4. UI polish 不能替代真实 Agent 能力、Photoshop 实际执行与读回或 QA 通过。

## 6. 现有文档角色

1. `project-memory/Plan.md`：阶段路线、里程碑、顺序约束和验收口径。
2. `docs/project-master-plan.md`：长期项目计划书，区分已实现、当前开发和未来愿景。
3. `docs/agent-capability-map.md`：能力 inventory，用于盘点当前有哪些能力、实现位置、验证结果、边界和缺口。
4. `docs/reference-replication-project-plan.md`：参考图复刻专项计划。
5. `docs/design-domain-knowledge-implementation-plan.md`：设计领域定义和轻量知识入口计划。
6. `docs/design-knowledge-web-search-plan.md`：外部设计知识和网页搜索规划。
7. `docs/layout-grid-design-knowledge.md`：网格排版知识和 Grid DSL 规划。
8. `docs/smart-scaling-photoshop-transform-research-plan.md`：智能缩放和 Photoshop 变换研究。

本文件位于这些文档之上。其他文档可以继续保留，但必须服务于 Design Agent OS，不应成为第二套架构真相源。

## 7. 严格执行顺序

从现在开始，执行顺序按“先 Agent、后业务 skill”推进。

### 7.1 阶段 0：文档治理与方法论收口

1. 收口真相源。
2. 固定默认阅读顺序。
3. 降级高干扰文档。

这是所有后续开发的前置条件。

### 7.2 阶段 1：Agent 认知控制面

1. 修正用户意图理解。
2. 修正对话 / 澄清 / 确定性 Photoshop 操作 / 开放式设计任务的边界。
3. 消除“不经模型理解直接硬编码执行”的路径。
4. 消除“简单任务很慢、绕很多步、像傻子”的路径。

本阶段的目标不是做设计效果，而是让 Agent 至少像一个正常的控制系统，而不是一组互相竞争的硬编码分支。

### 7.3 阶段 2：Photoshop 执行控制面

1. 稳定 UXP、MCP、bridge 健康检查。
2. 稳定简单 Photoshop 操作的真实执行和真实读回。
3. 让错误、弹窗、无响应和 cleanup 都进入结构化控制。

如果执行层不稳定，后续任何设计能力都会被假通过和随机失败污染。

### 7.4 阶段 3：验收与 QA 控制面

1. 统一 ExecutionTrace 和 VerificationReport。
2. 明确“工具成功”“执行成功”“设计完成”“质量通过”的区别。
3. 建立自动停机和失败反馈机制。

没有这一层，Agent 只会不断调用工具，却不知道自己到底有没有做对。

### 7.5 阶段 4：Planner / 契约 / DSL

1. 把 `UserIntent`、`DesignBrief`、`AssetUnderstanding`、`VisualUnderstanding`、`DesignDSL`、`ExecutionPlan`、`ExecutionTrace`、`VerificationReport` 真正接成运行时主线。
2. 让 executor 只消费计划，不在执行期继续承担大量推理。
3. 在 Photoshop 执行控制面稳定后，允许新增受控脚本化执行引擎作为 ExecutionPlan 的批处理解释器；它只提升确定性执行效率，不替代视觉理解、审美判断或验收。

### 7.6 阶段 5：通用设计闭环

1. 优先打穿参考图复刻。
2. 证明 Agent 能完成“理解需求 -> 规划 -> Photoshop 执行 -> QA -> 修正”。

这一步通过前，不能把业务 skill 的局部效果误写成通用设计能力完成。

### 7.7 阶段 6：共享设计能力补强

1. 文本排版。
2. Grid DSL。
3. 智能缩放。
4. 图片置入。
5. 素材理解。
6. 设计知识与 recipe 入口。

这些都必须作为共享层服务总控，不允许直接硬编码进主图、详情页或 SKU。

### 7.8 阶段 7：业务 skill 集成

1. `main-image-design`
2. `detail-page-design`
3. `sku-batch`
4. `ecommerce-design` 统一父 skill

它们只能建立在前面通用能力之上，不得反向定义 Agent 架构，也不得在基础设施未稳定前继续扩张策略和 UI。

### 7.9 阶段 8：偏好与学习

1. 用户偏好。
2. 项目偏好。
3. 可复用 recipe 和记忆。

这一层必须后置，不能用“学习能力”掩盖当前基础能力不稳定。

## 8. 冻结规则

1. 在阶段 1 到阶段 4 没有稳定通过前，主图、详情页、SKU 只允许做必要 bugfix、验收、边界澄清和只读观察，不继续扩新设计策略。
2. 新的设计知识、网页搜索、视觉模型入口、父子 skill 编排，都必须说明自己服务于哪个阶段；如果没有明确消费者，不进入实现。
3. 任何 benchmark、synthetic case、单次成功截图，都不能推动阶段跳级。
4. 任何业务 skill 不得再新增第二套规划入口或第二套控制平面。
## 9. 不可外推结论

1. 当前不能宣称“一句话自动设计已经完成”。
2. 当前不能宣称“参考图高保真复刻已经完成”。
3. 当前不能宣称“知识库 / RAG / 网页搜索已经完整可用”。
4. 当前不能把 Photoshop 工具成功当成设计任务成功。
5. 当前不能把 FEX 或任一单 case 当成通用设计能力。

## 10. 验收口径

本架构收口完成的验收标准：

1. 本文档存在并成为顶层架构入口。
2. `Plan.md` 有 M0d 控制平面与数据契约里程碑。
3. `CurrentTask.md` 指向本轮架构收口，而不是继续堆旧任务。
4. `Intake.md` 记录 Design Agent OS、端到端自动设计、Photoshop 聚焦、文案事实锚定和知识搜索等需求归属。
5. `project-state.json` 的 activeRequest / activePlan 指向本轮架构收口。
6. 维护校验通过，且没有把未完成能力写成已完成事实。
