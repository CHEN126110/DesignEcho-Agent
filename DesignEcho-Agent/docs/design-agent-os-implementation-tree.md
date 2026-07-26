# Design Agent OS 实施树

日期：2026-05-14

## 1. 文档定位

本文件把 `docs/design-agent-operating-system.md` 中的 8 个子系统落成实施树。

它不是新的业务规划，也不替代 `Plan.md`。它的作用是把“我们接下来怎么从架构往下做”变成可检查的工程入口，避免主图、详情页、SKU、参考图复刻、文案、抠图等分支继续各自扩张。

## 2. 当前总判断

当前 Agent 基础设施不是从零开始，但还没有达到“会自动完成开放式设计”的状态。

已经具备的部分：

1. 意图路由、确定性简单操作、skill executor、工具验收、任务报告、项目记忆等基础设施已经有 smoke 和维护校验。
2. Design Agent OS 契约已经落到共享 TypeScript 类型与只读 evidence。
3. Design Planner MVP 已经进入参考图复刻、主图、详情页、SKU 等链路，但主要是只读证据和 preflight，不是最终执行决策真相源。
4. 主图草案闭环已经补了素材候选、视觉预检入口、执行对齐、截图 QA、pixel probe 和 QA 聚合器，但仍缺真实设计质量闭环。

尚未完成的核心部分：

1. Planner 还没有真正控制 Photoshop 执行顺序、工具选择和失败修正。
2. Visual Perception 已有项目级 VisualSamplingPlan 的成本边界，但还没有稳定把项目图片、画布截图、图层关系和参考图转成统一结构化事实。
3. Design DSL 还没有成为所有业务场景共同消费的执行中间层。
4. Verification And QA 主要验证结构、bounds、截图证据和 no-overclaim，尚不能判断审美质量。
5. User Feedback UX 只能显示真实 provider thinking/reasoning 和工具事件；不能保证所有 provider 都返回可展示 thinking。

## 3. 子系统实施树

### 3.1 Intent Control Plane

职责：判断用户真实意图、动作优先级、是否需要 Photoshop、是否需要澄清。

当前证据：

1. `task-classifier.ts`、`routing.ts`、`DesignAgentEngine` 已存在。
2. 简单 Photoshop 机械操作和可执行问句已经能走 deterministic-first。
3. `smoke:agent:intent-engine`、`smoke:layer-management:skill`、`smoke:document-management:skill` 已覆盖部分边界。
4. AGENT-110 已把参考图复刻移出模型前直达白名单：参考图复刻先经过模型路由，确定性 `layout-replication` 只作为模型误选时的安全兜底。

下一实施 gate：

1. 将 `UserIntent` 作为所有执行任务的入口证据。
2. 把“聊天 / 解释 / 保存 / 简单 Photoshop 操作 / 开放式设计任务 / 需要澄清”统一写入 intent decision report。
3. 真实 UI 回归 C-1141 类问题，验证简单问题不绕远路。
4. 补独立 Intent Deliberation Gate 报告，显式标注 `safe_direct`、`model_first`、`clarify_first` 和 `deterministic_fallback`，避免设计任务再次被硬编码直达。

非目标：

1. 不用关键词硬编码业务结果。
2. 不把知识问句错误升级成 Photoshop 写操作。
3. 不把所有请求都强制过模型，机械操作仍需保持快速稳定。

### 3.2 Context Memory

职责：组织项目、当前文档、素材、历史任务、用户偏好、风险和可恢复状态。

当前证据：

1. `project-memory` 已有 `Plan.md`、`CurrentTask.md`、`Intake.md`、`project-state.json`。
2. `maintenance:planning-check` 和 `maintenance:validate` 已验证基本结构。

下一实施 gate：

1. 定义统一 `ContextSnapshot`，包含当前项目、Photoshop 文档、用户选择、素材候选、任务历史和未验证项。
2. 所有开放式设计任务必须先生成 context snapshot，再进入 Planner。
3. 中断恢复时能从 `project-state.json` 和任务 evidence 判断继续点。

非目标：

1. 不靠聊天历史当唯一上下文。
2. 不把未验证规划写成已完成事实。

### 3.3 Visual Perception

职责：理解参考图、当前画布、项目图片、图层位置、主体、文本区域和视觉关系。

当前证据：

1. 参考图复刻已有最小设计表示、蓝图、match、visual QA。
2. 主图链路已有显式 `enableVisionPreflight` 的视觉预检入口。
3. 当前画布与图层读取可作为 Photoshop 状态证据。

下一实施 gate：

1. 定义 `VisualUnderstanding` 的真实证据来源：reference image、canvas snapshot、layer bounds、OCR、provider vision、manual note。
2. 没有图片或画布证据时，文案和设计任务必须降级为需要补充或低置信度。
3. 对项目图片建立 metadata-first 候选和显式 vision-preflight 的成本边界。
4. 项目级 VisualSamplingPlan 已作为第一阶段成本边界：只选择少量候选、记录 cache hit/miss/stale，不读取像素、不调用视觉模型。

非目标：

1. 不宣称从扁平图还原真实 PSD 历史。
2. 不编造款式、材质、场景和卖点。

### 3.4 Knowledge And Recipe

职责：提供设计定义、平台规则、版式规则、文案框架、Photoshop recipe、案例和网页来源证据。

当前证据：

1. 设计知识搜索规划和 MVP service 已存在。
2. 文案框架、Grid DSL、智能缩放、参考图 recipe 已进入规划或部分 smoke。

下一实施 gate：

1. 统一 `DesignKnowledgeResult`，保留 source、confidence、applicability 和 risk。
2. 先沉淀轻量 recipe 与案例，不启动重型知识图谱。
3. 让 Planner 召回知识时只产生约束或 recipe 候选，不直接产生 Photoshop 动作。

非目标：

1. 不把网页搜索结果写成项目事实。
2. 不用知识库绕过视觉证据和 Photoshop 验收。

### 3.5 Design DSL

职责：把需求、上下文、视觉理解和知识转成可执行中间表示。

当前证据：

1. `DesignDSL` 已在 Design Agent OS 契约中定义。
2. 参考图复刻、Grid DSL、主图草案、智能缩放已有分散的结构化表示。

下一实施 gate：

1. 定义统一 DSL 片段：canvas、grid、regions、textBlocks、imageSlots、subjectBox、styleRecipes、constraints、verificationTargets。
2. `layout-replication.executor` 和 `main-image.executor` 先消费 DSL 的只读校验，再逐步让 DSL 控制执行参数。
3. 智能缩放和文本排版必须挂到 DSL，不再各场景各写一套尺寸逻辑。

非目标：

1. executor 不再重新混合大量推理。
2. 没有 DSL 或执行计划时，不允许模型自由碰运气调用 Photoshop。

### 3.6 Photoshop Execution

职责：通过 UXP/MCP/Photoshop 工具执行真实图层创建、修改、保存、导出。

当前证据：

1. skill executor、Photoshop MCP、UXP 工具和验收 evidence 已存在。
2. 简单图层、文档、文字、参考图复刻、主图等链路已有不同程度执行器。

下一实施 gate：

1. 工具调用必须引用 `ExecutionPlan` 的 step id 或降级原因。
2. 写操作必须产出 `ExecutionTrace`，包括工具名、输入摘要、输出摘要、耗时、错误和 acceptance evidence。
3. UXP 面板工具与 Agent skill 继续分离；只有通过安全边界定义的工具才开放给 Agent。
4. AGENT-151 收口后评估 AGENT-152 受控脚本化执行引擎：模型输出短计划，系统执行白名单批处理，默认先用图层排序 MVP 证明效率和稳定性。

非目标：

1. 不用鼠标模拟替代可确定的 Photoshop 内部操作。
2. 不把工具 success 当任务 success。
3. 不开放任意脚本执行器、任意 Photoshop 命令行或模型自由 batchPlay 入口。

### 3.7 Verification And QA

职责：验证图层、bounds、文本、样式、截图、像素探针、人工评分和任务级结论。

当前证据：

1. acceptance snapshot/diff、tool evidence、参考图 visual QA、主图 screenshot QA、pixel probe、QA report 已存在。
2. 架构报告明确不能把这些证据外推成审美质量完成。

下一实施 gate：

1. 所有设计任务都输出 `VerificationReport`。
2. 把结构验收、视觉验收、人工验收、模型复核拆开评分。
3. 允许失败、需复核和证据不足成为正常结果，而不是让模型话术盖过去。

非目标：

1. 不用启发式 QA 宣称审美通过。
2. 不把单个 benchmark 当通用能力。

### 3.8 User Feedback UX

职责：向用户展示真实模型可见输出、工具调用、执行证据、阻塞原因和下一步修正。

当前证据：

1. Pondering 已区分 provider thinking/reasoning、工具调用和任务报告。
2. 固定路由、status、skill telemetry 不应进入“正在思考”。
3. 普通纯文本对话已有 provider token streaming；tool-calling 和多模态流式仍未统一。

下一实施 gate：

1. UI 只展示真实 provider thinking/reasoning 或模型公开可展示判断，不展示本地模板伪思考。
2. 工具调用显示工具事件和摘要，不放进 thinking。
3. 任务报告显示阻塞项、验收失败和未验证项，避免用户误以为完成。

非目标：

1. 不展示私有 chain-of-thought。
2. 不用“等待响应 / 正在准备”这种本地固定话术占据 thinking 区。

## 4. 后续实施顺序

### M0h：Design Agent OS 子系统实施树与架构 gate

目标：本文件和架构报告必须能回答 8 个子系统分别处于什么状态、有什么证据、下一步 gate 是什么。

验收：

1. `docs/design-agent-os-implementation-tree.md` 存在。
2. `maintenance:agent-architecture --json` 输出 `designAgentOsSubsystems`。
3. `smoke:design-agent-os:architecture-tree` 校验 8 个子系统、文档、脚本和 no-overclaim 边界。

### M0i：Planner 进入执行前控制面

目标：Planner 不再只是只读 evidence，而是在开放式设计任务执行前决定 readiness、blockers、requiredContext、DSL 和 verificationTargets。

验收：

1. 参考图复刻和主图任务在执行前消费 planner readiness。
2. 证据不足时能停止、降级或请求补充，而不是继续碰运气。
3. 不改变已验证的简单 Photoshop 确定性操作。

### M0j：Context Snapshot 与恢复点

目标：开放式设计任务统一生成上下文快照，避免 Agent 不知道“我是谁、我在哪、要干什么”。

补充：Context Snapshot 必须包含 ProjectAssetIndex。C-1140 这类真实项目同时包含原始拍摄图、颜色单品、主图成品、SKU 成品、详情页切图、模板和大型 PSB；Agent 需要先建立项目级素材理解索引，再决定是否调用主图、详情页或 SKU 等业务 skill。

当前落地：

1. `src/shared/project-asset-index.ts` 已提供只读 ProjectAssetIndex 和 ContextSnapshot helper。
2. `scripts/smoke-project-asset-index.cjs` 已覆盖 synthetic fixture 和 C-1140 live scan。
3. `src/shared/design-planner.ts` 已能消费 `projectContext.assetIndex`，把素材索引进入 Planner evidence。
4. `src/main/services/project-context-snapshot-service.ts` 已提供只读 runtime ContextSnapshot 构建服务。
5. `ecommerce:buildContextSnapshot` 与 preload `buildProjectContextSnapshot` 已暴露给 renderer。
6. `getProjectContext()` 已把 `assetIndex/contextSnapshot` 带入 Agent 上下文；主图、详情页、SKU、参考图复刻 planner evidence 已读取该索引。
7. `src/shared/project-visual-sampling.ts` 已提供有界视觉抽样计划和 cache hit/miss/stale 契约。
8. Runtime ContextSnapshot、renderer `getProjectContext()` 和 Design Planner 已携带 `visualSamplingPlan`；该计划不读取像素、不调用模型、不声明已理解图片内容。

验收：

1. 快照包含项目、文档、素材、当前选择、用户约束和未验证项。
2. 中断恢复能从快照继续，而不是重新猜。
3. 素材索引能区分原始素材、颜色单品、真人穿着、静物铺拍、细节特写、成品图和模板，不默认批量调用视觉模型。
4. `smoke:project-context-runtime` 证明 runtime service 只读生成 ContextSnapshot，且不把上下文证据说成 Photoshop 执行结果。
5. `smoke:project-visual-sampling` 证明视觉抽样候选有上限、cache 状态可复用且不会编造产品款式、场景或卖点。

### M0k：Agent 性能预算与资源控制面

目标：把模型调用、工具调用、视觉分析、项目扫描、图片读取、验收等级和用户等待体验纳入同一个预算面，避免 Agent 为简单任务绕远路，也避免开放式设计任务无边界消耗资源。

当前落地：

1. `src/shared/agent-performance-policy.ts` 已提供只读 `AgentPerformancePolicy`，按任务类型给出模型、视觉、工具、图片候选、扫描和验收预算。
2. `src/shared/design-planner.ts` 已把 performance policy 挂到 planner output 和 selectedContext，用作诊断与执行前 evidence。
3. `smoke:agent:performance-policy` 已覆盖普通聊天、简单图层操作、详情页/开放设计任务的预算边界和 no-overclaim。
4. 架构报告与项目 cockpit 已输出 `agentPerformancePolicy`，用于持续观察该横切控制面是否存在。
5. `autonomous-agent` legacy 默认迭代预算、`design-team` teammate 默认迭代预算、`ContextManager` 默认上下文窗口、`ResourceManagerService` 缓存 TTL、provider adapter / `ModelService` / `stream-adapter` 默认输出 token、`tool-acceptance` 快照采集预算和 `ProjectVisualSamplingPlan` 候选预算已迁入 policy helper，保持既有行为不变。

下一实施 gate：

1. 继续把现有 executor 中的 magic number 逐步迁到不可变 policy，但不在同一轮改变 Photoshop 写入行为。
2. 记录真实 provider、工具、视觉分析和 Photoshop 操作耗时，形成任务级 performance trace。
3. 将只读 policy 推进为硬预算：超预算时降级、暂停、请求用户确认或给出阻塞原因。
4. UI 显示资源与等待原因时，只显示真实模型输出、工具调用和事实 evidence，不用本地模板伪装成思考。

非目标：

1. 不通过降低质量或跳过必要验收来换取“快”。
2. 不把 performance policy 写成任务成功、设计质量通过或模型理解完成。
3. 不把系统执行日志、路由状态或本地模板显示为模型思考。

### M1/M5：业务场景重新接入控制层

目标：参考图复刻和主图继续作为验证场景，但必须消费 OS 子系统结果。

验收：

1. 真实 Photoshop 输出截图、人工评分和错误样本进入 evidence。
2. 业务场景不再形成第二套路由、第二套 DSL 或第二套 QA。

## 5. 当前禁止外推

1. 不能说 Agent 已经和模型一样聪明。
2. 不能说自动主图、详情页、SKU、参考图复刻已经通用完成。
3. 不能说 Planner 已经控制真实 Photoshop 执行。
4. 不能说截图、bounds 或 pixel probe 等于审美质量通过。
5. 不能把 FEX 或 synthetic case 当成产品能力。
