# DesignEcho 项目计划书

日期：2026-04-26

## 1. 文档定位

这份文档是项目总规划的当前版本，用于把三类内容分清楚：

1. 已经实现并通过验证的能力
2. 当前正在开发或应该优先开发的能力
3. 用户希望未来实现、但当前还没有实现或没有验证结果证明成熟的能力

本文件不是宣传文案，不把愿景写成事实。任何能力只有具备可定位代码，并通过构建、smoke、真实 Photoshop 手测或用户验收，才可以写入“已实现”。

顶层架构入口见 `docs/design-agent-operating-system.md`。本文件负责长期路线和状态边界；Design Agent OS 负责定义 Agent 控制系统、数据契约和各业务场景如何统一接入。

模型设置与配置边界见 `docs/model-settings-configuration.md`。当前模型配置真相源是 `src/shared/config/models.config.ts`；Xiaomi MiMo 官方可选项只保留 `mimo-v2.5-pro` 与 `mimo-v2.5`，旧 `mimo-v2-pro` / `mimo-v2-omni` 仅作为历史设置迁移对象。

## 2. 总目标

DesignEcho 的长期目标是成为一个可靠的 Photoshop 设计 Agent：用户可以给一句话、一张参考图或一个项目素材文件夹，Agent 能理解设计目标，调用 Photoshop 工具生成可编辑结果，并能对结果做验收、发现问题和持续修正。

更准确地说，项目目标不是“做一个详情页工具、主图工具、SKU 工具或参考图复刻工具”，而是做一个会使用 Adobe Photoshop、并逐步具备设计判断能力的 Agent。主图、SKU、详情页、参考图复刻、文案优化、抠图、局部重绘等都只是当前用于验证和落地这套能力的业务场景。

当前不能直接跳到“全自动卓越设计”。项目必须先把以下基础做实：

1. 真实理解用户意图，而不是硬编码抢路
2. 真实理解 Photoshop 文档、图层、位置、尺寸、样式和关系
3. 参考图复刻能从“骨架生成”逐步走向“可编辑、高相似、可验收”
4. 每次 Photoshop 操作都有可复核的前后读回
5. 项目研发过程可恢复、可验收、可定位问题

能力分层：

1. Agent 基础设施：意图理解、路由、模型调用、工具调用、流式可观测、任务报告、错误恢复。
2. Photoshop 操作能力：文档、图层、文本、图片、形状、选区、蒙版、样式、变换、导出。
3. 设计理解能力：参考图解析、版式关系、视觉层级、图片落位、文案角色、风格与 recipe。
4. 设计执行能力：把设计 DSL / blueprint 转成可编辑 Photoshop 图层，并在执行后读取真实状态验收。
5. 业务场景能力：主图、SKU、详情页、电商设计、平面设计、品牌设计等，均应复用上面四层，而不是各自硬编码一套。
6. Benchmark 与验收：FEX 这类样例只用于验证某个能力点，例如文本排版、图层落位或截图相似度；benchmark 不是产品功能、不是工具，也不能代表完整设计能力。

## 3. 当前已实现并已核实的能力

以下内容来自项目记忆与最近验证结果。

### 3.1 Agent 意图与路由边界

已实现：

1. `layout-replication`、详情页、主图、文档操作、字体替换、抠图等代表性场景或操作能力已进入 skill / routing 体系；它们不是 DesignEcho 的能力边界。
2. 纯聊天、模型身份、模型比较、解释型问题会优先走对话分支，不触发 Photoshop 执行链。
3. 普通用户请求不会被 `agent-panel-bridge` 内部调试能力抢走。
4. “好像没改成功，再改一下”会尝试沿用上一条可执行任务，而不是默认生成调试桥接 JSON。
5. 已修复“主图模板”误命中“详情页模板”的正则问题。
6. 已新增聊天执行链路 smoke，用代码级方式验证 ChatPanel 普通输入进入 unified Agent、工具结果进入 thinking steps、MessageRenderer/parser 展示摘要且不默认暴露 raw JSON。
7. 已修复运行时完成结论真相源：当 `executionSummary` 是 `failed` 或 `needs_review` 时，不再把模型最后的“已成功/已完成/已保存/已验证”类话术作为完成结论展示。
7. 已新增默认关闭的 ChatPanel 测试桥接入口，仅在 `DESIGNECHO_CHAT_TEST_BRIDGE=1` 时由主进程注入 query 并暴露最小测试 API。
8. 已新增显式 Electron bridge smoke `smoke:chat-ui:electron-bridge`；测试实例使用隔离 userData、隔离端口和一次性项目，不会挤掉用户正在运行的桌面端或 8765 UXP 桥接。
9. 自主 Agent 达到最大迭代次数时不再被标记为成功，而是返回 `stopReason=max_iterations`。
10. 自主 Agent 已新增重复工具链和连续失败轮次保护，用于减少空转；明确命中的用户可执行技能会先于 `autonomous_agent` 执行。
11. Agent runtime 已新增 `executionSummary`，当模型最终文本声称完成但工具失败、验收断言失败或出现无文档变化风险时，不再把结果标记为完成。
12. ChatPanel 和消息解析器已开始把 `executionSummary` 渲染为“任务报告”卡片；完成态默认折叠，失败和需复核默认展开。
13. Debug Bridge / MCP debug session 已支持保存 `executionSummary`；默认脱敏摘要只暴露状态、计数和摘要文本，不暴露完整 `lastError`。
14. 消息解析器会过滤空的 thinking/decision 占位步骤；只有工具进度、没有真实模型 thinking 时，标题显示为“处理中”，不伪装成“思考”。
15. 历史消息的 `ThinkingBlock` 组件已清理乱码标题和注释，默认标题改为“处理中”，避免兜底文案变成乱码或伪思考。
16. 模型路由器的意图判断已从 `thinking` 展示链路收口为 `intentSummary` / 状态摘要，不再把“用户意图摘要”冒充成 Pondering 里的模型思考。
17. 自主 Agent 会过滤明显损坏的模型 thinking，例如连续问号或替换符；过滤时不伪造替代思考内容。
18. 主图执行器的用户可见结果和进度文案已从英文内部日志改为中文反馈，避免把 `Main image design completed`、`layout candidate score` 等调试式文本直接展示给用户。
19. 已新增 `maintenance:agent-architecture` 架构体检命令，可把 Agent 架构 gate 标为 `ready / mvp / planned / missing`，当前结论为 `mvp_ready_not_complete`。
20. 已移除本机 DeepSeek 网页端代理接入，避免把网页会话代理误当成稳定生产 API。
21. 已新增 DeepSeek 官方 provider，当前只接入 `deepseek-v4-pro`，使用官方 OpenAI 兼容地址 `https://api.deepseek.com`；按官方文档声明 Tool Calls、JSON Output、思考模式、1M 上下文与最大 384K 输出，不声明未确认的视觉输入能力。
22. 隔离 Electron ChatPanel smoke 已覆盖 `/help`、模型身份问题、普通设计聊天、`帮我关闭文档不保存`、`帮我把详情页文档保存到项目的PSD中`、失败验收任务报告样本，并验证文档保存/关闭样本不会被详情页执行链劫持，失败 `executionSummary` 不会被乐观模型完成文案覆盖。
23. 文档管理 executor 的用户可见保存/关闭/切换/新建反馈已恢复为正常中文，并新增“导出详情页文档成 PNG”动作优先级回归：该请求进入 `document-management` 的 save/export 语义，不进入详情页设计执行链。
24. 已明确三模型协作边界：当前真实实现是 `layoutAnalysis / textOptimize / visualAnalyze` 三个任务模型桶按任务选择模型，不是三个模型同时流水线协作。
25. 已修复三模型任务分流中的中文关键词乱码；源码改为 ASCII Unicode escape，避免 PowerShell 或终端编码再次把中文路由条件写坏。
26. 已新增 `smoke:model-selection:routing`，验证参考图/复刻请求走视觉模型桶，文案请求走文案模型桶，保存详情页 PSD 走逻辑模型桶，模型身份问题保持通用对话，纯文本 DeepSeek 不会被当作视觉模型。
27. 已新增可选 live API 质量样本 `smoke:model-routing:live-quality`：默认不调用外部 API；设置 `DESIGNECHO_LIVE_MODEL_SMOKE=1` 后会用当前配置验证逻辑桶文本、文案桶文本、视觉桶图片理解和逻辑桶 `chatWithTools` 的最小响应形态。
28. 已新增结构化 Agent step 事件基础：runtime 可向 UI 发出任务开始、模型请求/响应、工具计划、工具开始/完成、观察、验收和停止事件；ChatPanel 会把这些事件展示到 Pondering，用于显示事实步骤和工具调用，不再依赖空 thinking 占位。

三模型边界：

1. `layoutAnalysis` 是逻辑与执行模型桶，负责普通对话、意图判断、技能选择、Photoshop 工具链和需要 tool calling 的任务。
2. `textOptimize` 是文案模型桶，负责文案生成、改写、标题、卖点、话术和图片分析后的文本总结。
3. `visualAnalyze` 是视觉模型桶，负责带图输入、参考图理解、视觉结构解析、图片内容理解和参考图复刻前的视觉解析。
4. 多 Agent 角色当前主要通过角色 prompt 与工具权限分工，不等于已经稳定绑定不同模型；默认 delegated teammate 仍可能走逻辑模型。
5. `DEFAULT_ORCHESTRATOR_CONFIG` 已存在，但仍不能被描述为完整生效的 orchestrator-workers 生产架构；后续需要把 worker model 真正接入 `DesignTeamCoordinator` 和任务生命周期。

已验证：

1. `npm run smoke:agent:intent-engine` 通过
2. `npm run build:main` 通过
3. `npm run build:typecheck:renderer` 通过
4. `npm run smoke:chat-ui:execution-chain` 通过
5. `npm run smoke:agent:runtime-guard` 通过
6. `npm run smoke:debug-bridge:redaction` 通过
7. `npm run smoke:main-image:design-skill` 通过
8. `npm run maintenance:validate` 通过
9. `npm run maintenance:agent-architecture` 通过
10. `npm run smoke:model-provider:deepseek` 通过
11. `npm run smoke:model-selection:routing` 通过
12. `DESIGNECHO_LIVE_MODEL_SMOKE=1 npm run smoke:model-routing:live-quality` 已通过一次真实 API 探针：当前配置中 `layoutAnalysis/textOptimize` 为 `deepseek-v4-pro`，`visualAnalyze` 为 `xiaomi-mimo-v2.5`，并验证 DeepSeek tool call 可返回 `echo_status`。
13. `npm run smoke:agent:step-events` 通过，验证 Agent step 事件链路和敏感工具参数脱敏。

未完成：

1. 真实聊天 UI 已有受控 Electron 自动化样本；live API 最小质量样本与真实 Photoshop 保存/关闭磁盘状态验收已补，但还缺真实用户 UI 路径下的端到端质量验收。
2. 路由仍不是完整语义系统，仍需要真实用户请求样本持续扩展评估。
3. 运行时空转保护只能防止假成功和重复消耗，不证明复杂设计任务已经完成。
4. `executionSummary` 当前已有消息级任务报告卡片和 Debug Bridge 脱敏摘要接入，但尚未做完整的项目级验收报告面板和真实 Electron 窗口点击自动化。
5. 三模型目前是任务模型桶与候选优先级机制，不是完整三模型协同流水线。
6. 多 Agent 角色还没有稳定绑定 `vision / copy / logic` worker model，也没有持久任务记录和 critic 验收闭环。
7. live API 样本目前只证明最小响应形态，不证明设计质量、长任务稳定性或复杂工具链可靠性。
8. 当前已有步骤级可观测事件，不等于所有 provider 都已接入 token 级流式输出；普通聊天最终答案的 token streaming 需要单独按 provider 能力实现。

### 3.2 参考图理解与复刻基础链路

已实现：

1. 已存在独立 `layout-replication` skill 与执行器。
2. 已抽出参考图解析、最小表示、blueprint 推导、match、autofill、template apply、QA 等模块。
3. blueprint screen 分组已由参考图解析出的元素角色推导，不再默认给每一屏强塞 `文案 / icon / 图片`。
4. 参考图基础样式已进入 DSL 与落地链路，包括颜色、文字颜色、透明度、圆角、字号比例。
5. 样式 recipe 成熟度识别已存在，可区分基础可落地、已规划未执行、不支持效果。
6. Photoshop style recipe 已开始进入参考图复刻链路：`stroke 描边` 在解析到 `effects:["stroke"]` 且存在 `strokeColor` 时，会通过受控参数调用 `addStroke` 应用纯色内描边；`shadow 投影` 在解析到单独 `effects:["shadow"]` 时，会通过受控参数调用 `addDropShadow` 应用柔和投影。缺少必要字段、组合风险或执行失败会进入需复核/失败统计。
7. 现有文档匹配路径已增加执行前参数闸门，可拦截非法工具、非法图层、缺少目标图层、越界参数、非法字号、非法不透明度、非法 `addStroke` RGB 参数和非法 `addDropShadow` 投影参数。
8. `layout-replication.executor` 已新增完成判定收口：无可执行匹配、模板落地失败、自动填充失败、匹配部分失败或零成功调整时，不再返回成功或显示“完成”。
9. 已新增参考图复刻视觉几何 QA MVP：模板落地后会读取新建图片/装饰占位图层的 Photoshop 实际 bounds，并与计划 bounds 计算 IoU、中心偏移、边缘偏差、面积比例，输出 `ok / watch / mismatch / unverified` 报告。
10. 已将 UXP 既有 `getScreenSnapshotsWithOverlay` 接入参考图复刻的显式深度验收路径：仅当 `visualValidation=overlay/deep/screenshot(s)` 或 `includeOverlaySnapshots=true` 时采集 overlay 截图观察，默认运行仍保持 bounds-only。
11. overlay 截图结果在普通 `toolResults/data` 中只保留摘要、截图数量、屏幕尺寸和 base64 字节估算；真实 base64 不进入普通消息结果，避免拖慢 UI 和污染模型上下文。
12. 参考图复刻视觉 QA 已新增结构化检查报告，统一输出 blocker / warning / nextActions，并显式标记 `rawImagesRedacted=true`。
13. 模板落地完成判定已接入 overlay blocker：显式请求 overlay 但没有获得截图时返回“需复核”，不把零截图深度验收当成功。
14. 已新增可选 live smoke：`npm run smoke:reference:overlay-live`。该脚本会创建一次性 Photoshop 文档、构造目标框/实际框、调用 `getScreenSnapshotsWithOverlay`，并在报告中隐藏真实 base64。
15. 已修正 UXP `getScreenSnapshots` / `getScreenSnapshotsWithOverlay` 的返回契约：单屏截图失败会收集 `errors`，如果没有生成任何截图则返回失败，不再把空 `snapshots` 伪装为成功。
16. Agent 侧 overlay 摘要也已收口：即使旧版运行中 UXP 返回 `success:true + snapshots:[]`，也会被标记为 overlay 失败/未验证，而不是当作有效截图观察。
17. 已修复 UXP overlay 截图在当前 Photoshop UXP 环境中不能依赖 Canvas 的问题：现在直接在 `getPixels` 得到的 RGBA 像素上绘制目标框/实际框，转成 RGB 后通过 Photoshop Imaging API 编码。
18. UXP 构建已同步输出 `dist/runtime.js` 和历史入口 `dist/index.js`，避免 Photoshop 会话加载旧 `index.js` 时继续执行过期 bundle。
19. 已新增非 live 回归契约 `npm run smoke:reference:overlay-contract`，检查 overlay 截图仍走像素 RGB + Photoshop Imaging API 路径、禁止回退到 DOM Canvas / OffscreenCanvas，并确认 UXP webpack 同步输出 `runtime.js` 和 `index.js`。
20. 已录入第一个真实参考图 benchmark case：`rr-001-fex-certificate-text-layout`。该 case 来自用户提供的 FEX 合格证文本排版图，包含 460x460 参考图资产、11 个期望可编辑文本元素、像素阈值检测得到的 bounds、6 条验收标准和独立 smoke。该 case 只用于验证文本排版、图层落位和参考图复刻链路，不能被当成产品功能、工具或完整设计能力。
21. 已接入 `layout-replication` 确定性路由：`参考图 + 复刻/照着做/仿照/生成同款版式` 不再完全依赖模型猜测，也不会被模型误判成其他 user-facing skill 后抢走。
22. 已新增参考图复刻自动画布策略：`reference-replication` profile 默认保持参考图尺寸，`detail-template` profile 默认保留 800x1200 生产下限，显式 `outputWidth/outputHeight` 仍优先。
23. 已新增参考图复刻文本落位辅助：把模型解析出的“视觉外接框”转换为 Photoshop `createTextLayer` 的初始基线位置，并在创建后读取真实 bounds，通过 `moveLayer` 做相对校正；短字段如 `品牌:FEX` 不再因长度短被当作标题字号处理。字号会同时参考 `fontSizeRatio` 与视觉外接框高度，避免标题类文字在 Photoshop 中按点数渲染后明显偏小。若无法读取文字实际 bounds，或校正后仍偏移，会进入失败/需复核计数，不再静默当作成功。
24. 参考图复刻 bounds QA 已覆盖文案占位；FEX 这类纯文本参考图不再因为没有图片占位而缺少几何验收项。显式 overlay/deep 验收也会传入文本目标框和实际框。
25. 参考图解析已收紧关键字段：缺失 `canvasSize`、元素 `position` 或 `size` 时直接解析失败，不再默认到 `1242x1600`、中心点或固定尺寸，避免把视觉模型没看懂伪装成可执行蓝图。
26. 文本落位校正已改为最多两轮真实 bounds 校正，并对刚创建/刚移动文本层的 `getLayerBounds` 增加稳定化重试，避免 Photoshop 短暂未返回 bounds 时把结果误判为完成或无效。
27. UXP `moveLayer` 源码已从 DOM `layer.translate()` 改为项目内其它布局工具使用的 `batchPlay move + offset` 路径，避免工具返回成功但文本层实际 bounds 未移动；已在重载 UXP 后通过 FEX live smoke 验证。
28. 文本落位已增加受控字距宽度适配：当单行文本真实 bounds 与参考黑色像素框只有小幅宽度差异时，执行器会估算 Photoshop tracking 并同时写回当前字号，避免只设置 `tracking` 导致字号被 Photoshop descriptor 重置；大幅尺寸错误不会被字距掩盖，仍进入需复核/失败。
29. 已新增隔离 Electron UI smoke `smoke:chat-ui:reference-replication`：通过真实 ChatPanel 图片提交路径、真实统一 Agent 路由和真实 `layout-replication` executor，使用受控 fake 视觉解析 JSON 与 fake Photoshop 空文档工具桩，验证参考图复刻请求不会落入普通对话、不会泄露内部 bridge JSON、不会出现 max-iterations 文案，并且 FEX 元素覆盖必须达到 11/11。
30. 工具依赖检查已支持显式目标：对真实支持 `layerId / layerIds / updates` 直达的工具，参数中有明确目标时不再被 `selectLayer` 依赖门误拦截；无明确目标或工具不支持直达目标时仍必须先选中图层。
31. 模板落地成功语义已收紧：`applyTemplateBlueprintToDocument` 必须 `failedOps === 0 && createdLayers > 0` 才返回成功；视觉分析工具回调也必须等 JSON 解析和有效元素校验通过后才报告成功。
32. placement QA 在没有真实 visual QA 观察结果时会明确降级并说明尚未完成视觉检查，不再只靠 placementPlan 覆盖率给出乐观评分。

已验证：

1. `npm run smoke:reference:blueprint-groups` 通过
2. `npm run smoke:reference:match-validation` 通过
3. `npm run smoke:reference:style-recipes` 通过
4. `npm run benchmark:reference-replication:validate` 通过
5. `npm run smoke:layout-replication:completion` 通过
6. `npm run smoke:reference:visual-qa` 通过
7. `DesignEcho-UXP npm run build` 通过
8. `npm run smoke:reference:overlay-live` 已在连接 Photoshop 和 UXP Developer Tools 的会话中通过，报告显示 `renderMode=pixel-rgb-imaging-encoder` 且截图 base64 已脱敏。
9. `npm run smoke:reference:overlay-contract` 通过，并已纳入 `maintenance:preflight`；`smoke:reference:visual-qa` 也已纳入 `maintenance:preflight` 的非 live 检查链路。
10. `npm run maintenance:preflight` 已通过新增后的完整本地预检。
11. `npm run smoke:reference:fex-text-layout-case` 通过：检测到 9 行、11 个文本框，首框 `x=160,y=41,width=141,height=45`，末框 `x=37,y=404,width=353,height=22`。
12. `npm run smoke:layout-replication:canvas-policy` 通过：验证 FEX 这类 460x460 参考图不会在参考图复刻路径被放大到详情页最小尺寸。
13. `npm run smoke:agent:intent-engine` 通过：验证参考图复刻确定性路由不会被错误模型 skill 决策劫持。
14. `npm run smoke:agent:runtime-guard` 通过：验证失败/需复核任务不会展示模型乐观完成话术。
15. `npm run smoke:layout-replication:text-placement` 通过：验证 FEX 文本字段角色、字号比例优先、视觉框到基线初始坐标、以及 bounds 校正计算。
16. `npm run smoke:reference:visual-qa` 通过：验证 visual QA 基础规则，并检查文案占位已进入参考图复刻 bounds QA item 构造。
17. `npm run smoke:reference:screenshot-pixel-probe` 通过：验证截图像素探针库的同图通过、差异图 watch、base64 解码和原始图像脱敏契约。
17. `npm run smoke:reference:fex-text-placement-live` 已在连接 Photoshop + UXP 的会话中通过：11 个文本层创建和清理成功，bounds QA 为 ok 11、watch 0、mismatch 0、unverified 0；临时文档关闭成功并恢复原活动文档。
18. `npm run smoke:layout-replication:text-placement` 已增加回归断言：模板落地不允许 `failedOps > 0` 时返回成功，live smoke skipped 不允许作为通过。
19. `npm run smoke:reference:fex-text-layout-case` 已增加回归断言：缺失 `canvasSize/position/size` 必须解析失败。
20. `npm run smoke:reference:visual-qa` 已增加回归断言：参考图分析不能在解析校验前报告成功，尚未取得视觉观察的 placement QA 必须降级。
21. `npm run smoke:chat-ui:reference-replication` 通过：隔离 Electron 会话中提交 FEX 参考图，前端真实图片路径进入 `layout-replication`，生成 11 个可编辑文本层骨架，元素覆盖 11/11，用户可见结果不再包含错误的 `失败/跳过操作`；由于尚未完成截图级对比，结果仍会保留 overlay 验收提醒，不能判定为高保真完成。
22. `npm run smoke:tool-dependencies:param-targets` 通过：验证显式 `layerId / layerIds / updates` 可满足支持直达目标工具的 `selectLayer` 依赖，同时无明确目标时仍会阻断。
23. `npm run smoke:reference:fex-text-placement-live` 已新增截图像素探针：真实 `getCanvasSnapshot` 可采集截图并保存到 `tmp/reference-fex-text-placement-live-snapshot.png`；当前像素探针为 `watch`，指标为 `mae=13.445`、`rmse=47.852`、`highDeltaRatio=0.0885`、`darkJaccard=0.4399`。
24. 截图像素探针已从 FEX live 脚本抽出为 `scripts/lib/reference-screenshot-pixel-probe.cjs`，并新增 `smoke:reference:screenshot-pixel-probe` 校验同图通过、黑白差异进入 watch、原始图像内容脱敏；该能力当前只输出诊断结果，不作为默认高保真通过标准。

未完成：

1. benchmark 已有第一个真实文本排版案例，但它只是文本排版测试样例；仍缺少海报、详情页、主图、SKU、品牌视觉等更复杂真实案例和执行结果截图。
2. 参考图复刻还不能宣称高保真。
3. 当前 QA 已包含结构启发式评分、bounds 级视觉几何对比、显式 overlay 截图观察入口和 FEX 工具级截图像素探针；但截图探针仍是诊断输出，不是最终审美评分或高保真通过标准。
4. `stroke 描边` 仅是受控 MVP：支持纯色内描边和启发式宽度，不支持渐变描边、混合模式或精确描边位置还原。
5. `shadow 投影` 仅是受控 MVP：支持单独 shadow 效果映射为柔和黑色投影，不反推原作者真实参数；同层 `stroke+shadow` 暂跳过 shadow，避免当前 UXP 图层样式工具合并未验证时互相覆盖。该能力尚未做真实 Photoshop live 复验。
6. 渐变、发光、模糊等 Photoshop recipe 还没有真实执行闭环。
7. overlay live smoke 只证明一次性文档中的叠框截图链路可用，不证明参考图复刻已经达到像素相似度、高保真或审美质量合格。
8. FEX 用户实测暴露的路由、画布、文本落位、错误依赖门和最终话术问题已修复代码基础设施；工具级文本落位 live 诊断当前已达 `ok 11 / watch 0 / mismatch 0 / unverified 0`，隔离 UI smoke 当前为 11/11 覆盖且无失败/跳过操作。但截图像素探针仍为 `watch`，说明字体/字形/抗锯齿级相似度未达可宣称高保真的状态。仍需用真实 Agent UI、真实模型解析和真实 Photoshop 流程执行同一张 FEX 图，验证任务报告状态和用户可见结果；这一步不能由工具级或 fake UI smoke 代替。
9. `smoke:chat-ui:reference-replication` 仍是受控 fake model / fake Photoshop 的 UI 链路测试，不证明真实模型解析质量、真实 Photoshop live 写入质量或截图级设计相似度。

### 3.3 智能缩放与 placement

已实现：

1. 已新增智能缩放策略真相源 `design-smart-scaling-policy.ts`。
2. 自动选图计划可以携带 `placementTransform` 和 `smartScalingDecision`。
3. UXP 的 `fillDetailPage` 和 `replaceImagePlaceholder` 已开始消费 placement 相关目标框。
4. UXP 已返回 `placementAudit` 和 `placementAuditSummary`，可记录计划 bounds 与实际 Photoshop bounds 的偏差。

未完成：

1. 真实 Photoshop 手测样本不足。
2. 当前 audit 主要验证图层 bounds，不验证主体视觉是否美观。
3. 智能缩放还不能宣称已经解决“审美自由变换”。

### 3.4 工程卫生与项目记忆

已实现：

1. 已有根级 `.gitignore` 和 `.gitattributes`。
2. 已把 `node_modules / dist / tmp` 从 Git 索引移出，不删除本地文件。
3. 已有仓库卫生巡检、改动边界巡检和维护验收命令。
4. 已建立 `project-memory`，用于保存状态、风险、计划和长期上下文。
5. 已新增只读项目驾驶舱 `maintenance:project-cockpit`，用于中断恢复和长期任务上下文校准。
6. 已新增只读 Photoshop 验收 live smoke `smoke:photoshop-acceptance:live`，用于在 UXP 插件已连接时确认验收快照入口真实可用。
7. 已新增写入型 Photoshop 验收 live smoke `smoke:photoshop-acceptance:write-live`，用于在一次性文档中验证中文文本创建、文本修改、图层移动、关闭不保存和切回原文档。
8. 已新增聊天 UI 执行链路 smoke `smoke:chat-ui:execution-chain`，并纳入 `maintenance:preflight`。
9. 已新增默认关闭的 ChatPanel 测试桥接入口，为后续真实 Electron 自动化提供 submit/getSnapshot/waitForIdle。
10. 已新增显式 Electron bridge smoke，测试实例使用隔离端口和隔离 userData；即使默认 8765 被用户桌面端占用也可以启动真实窗口完成 smoke。
11. 已新增只读 Agent 架构体检 `maintenance:agent-architecture`，用于判断架构基础设施是否只是 MVP 成型、是否存在 planned/missing gate。
12. 已新增真实 Photoshop 文档保存/关闭磁盘验收 `smoke:photoshop-document:save-close-live`：在一次性文档中保存 PSD 到磁盘、制造未保存修改、关闭不保存，并验证 PSD 文件存在、非零大小且关闭不保存没有再次写盘。

已验证：

1. `npm run maintenance:validate` 通过
2. `npm run maintenance:change-boundaries` 当前可把改动归入明确边界
3. `npm run smoke:photoshop-acceptance:write-live` 已在连接 UXP 插件的 Photoshop 会话中通过一次真实写入验收
4. `npm run maintenance:agent-architecture` 当前输出 `mvp_ready_not_complete`，明确知识层、截图级 QA、真实 UI 自动化和设计质量闭环未完成；多 Agent 已有最小 coordinator/task/registry，但不是完整设计团队闭环。
5. `npm run smoke:photoshop-document:save-close-live` 已在连接 UXP 插件的 Photoshop 会话中通过，报告显示 PSD 保存后和关闭不保存后的文件 size / mtimeMs 一致。

未完成：

1. 大量索引清理仍未提交。
2. 仍需验证打包、启动、插件加载流程不依赖被移出 Git 的构建产物。

## 4. 当前优先开发内容

### P0：助手回复去硬编码与模型回复治理

目标：让用户可见的自然语言助手回复来自模型或 Agent 回复生成器，而不是固定能力菜单、固定澄清模板、固定失败说明或内部状态码。

下一批开发内容：

1. 建立回复来源清单，区分模型自然回复、模型修复回复、结构化 UI 状态、工具结果摘要、确定性阻塞和测试 fixture
2. 将 `direct_response / clarification_needed / conversational unavailable / preflight blocker / executor failure` 中会进入助手气泡的固定自然语言改为结构化上下文，再交给模型或回复生成器生成
3. 保留必要 UI 标签和状态卡，但让它们明确属于界面状态，不伪装成模型回答
4. 改造 fake model / running-window 验收：fake model 对话必须标记为 `test_fixture`，后续再把固定样本文案迁移为可注入 provider fixture
5. 增加真实窗口回归，覆盖能力问答、项目问答、SKU 自选备注、C-1166 白底图语义和模型不可用降级

验收口径：

1. “你会做 SKU 吗 / 你可以做什么 / 当前是什么项目 / 我还需要对应 SKU 自选备注”不会出现固定菜单、固定澄清模板或内部状态码
2. 模型可用时自然回复来自模型或 Agent 回复生成器；模型不可用时不伪造能力介绍，不触发 Photoshop 工具
3. smoke 与真实窗口检查都能阻断旧固定菜单、工具/XML 泄漏和技术状态外露

当前状态：P0 in_progress。第一片已落地并验证：`assistant-reply-origin/v0` 已接入 Agent result、ChatPanel message 和测试桥快照；对话回复、模型路由直接回复/澄清、intent fallback、公开计划阻断、design preflight 阻断、skill executor 成功/失败、取消/暂停等路径已能区分模型自然回复、模型修复、UI 状态、工具摘要、确定性阻断和测试夹具。`smoke:agent:reply-origin-boundary` 已加入 package script；真实运行窗口已覆盖能力问答、项目只读、SKU 执行和自选备注缺素材场景，fake model 对话来源已标记为 `test_fixture/test_fixture`，不再冒充真实模型自然回复。第二片已落地：默认 fake provider 改为中性测试提示，历史产品式样本必须显式选择 `chat-ui-electron-bridge` fixture，手动 fake 调试窗口默认使用 neutral fixture。第三片已落地：`chat-ui-electron-bridge` 产品式聊天样本已集中到命名 rules suite，reference JSON、visible reasoning 和 acceptance failure/tool call 仍作为特殊测试逻辑优先处理。第四片已落地：design preflight 阻断源头改为复用公开状态文案，response cleaner 兼容清洗旧 preflight 实现话术和 executor 模板缺失细节，避免“Photoshop 写入 / 模型或人工 / 错误:”作为助手自然回复外显。第五片已在 2026-06-03 纠偏：`当前是什么项目 / 帮我看看当前是个什么项目` 不再走普通对话分支，而是进入只读项目元数据检查，避免模型按历史猜测；`项目都有什么` 仍保留 metadata inventory，`项目图片是什么款式` 仍保留内容分析。第六片已落地并验证：项目 inventory 只读工具摘要不再把“项目资源概览/下一步建议”作为普通助手回复展示，而是返回紧凑事实摘要，并把详细 overview 放入 `data.projectInventoryOverview`；消息解析器将 `tool_summary` 来源渲染为“处理摘要”结构化卡片。第七片已完成代码层修正：`blocker_notice/status_notice/tool_summary` 统一作为结构化卡片展示，独立内部状态码不会被清洗成固定助手正文，provider 失败不再返回固定自然回复而交给 `ui_status/status_notice`。第八至十二片已继续完成：无模型 task summary/continuation、本地 intent clarification、skill unavailable/no executor、no-tool replan 固定菜单、缺省来源降级、显示前归一化、高风险状态口吻和 ChatPanel 本地 assistant 写入显式来源均已收口。当前验证已覆盖 `smoke:agent:intent-engine`、`smoke:agent:intent-deliberation-gate`、`smoke-template-project-observability.cjs`、`smoke:agent:reply-origin-boundary`、`smoke:chat:response-cleaner`、`smoke:ui:user-facing-language-boundary`、`build:typecheck:renderer`、真实运行窗口检查和 `npm run build`。全量治理仍未完成，下一阶段继续处理状态卡剩余口吻审计、prompt/test fixture 旧样本边界、截图定位稳定性和真实模型可用时的自然回复口吻验收。

最新补充：第十三片已完成并验证，真实运行窗口截图现在会锚定本轮最新 assistant 消息，并检测设置弹窗等遮挡层；对话层不再把模型 JSON `reasoning` 当作用户可见回复。第十四片已完成代码层修正：`chat-ui-electron-bridge` 命名 fake fixture 会显式标注“测试样本”，第一批确定性状态/阻断源头不再使用第一人称助手口吻。下一阶段剩余重点收窄为 prompt/test fixture 旧样本边界、fake fixture 外置、其他业务状态卡口吻审计和真实模型可用时的自然回复口吻验收。

最新补充 2026-06-03：第十一片已完成并验证，ChatPanel 缺省来源降级已落地到 store 和 message parser 两道边界：缺失来源、`origin=unknown` 或非法 `assistant_speech` 不再按普通助手文本渲染。高风险本地 fallback/status 文案已进一步收敛，能力不可用、抠图边界、SKU 配置阻断、主图 strategy-only 不再使用本地第一人称承诺式话术。验证覆盖 reply-origin、UI language、user-visible-state、tool-decision、response-cleaner、intent-engine、main/renderer typecheck 和完整 build。剩余重点是正在运行窗口的真实会话验收、ChatPanel 本地 action 显式来源补齐，以及 prompt/test fixture 中旧样本继续清理。

### P0：参考图复刻真实验收闭环

目标：让“用户给参考图，Agent 复刻设计”从雏形进入可评估状态。

下一批开发内容：

1. 继续扩充真实 benchmark case；当前已录入 `rr-001-fex-certificate-text-layout`，并已增加一次性 live 文本落位诊断和防假成功回归；下一步需要走真实 Agent UI/模型解析流程执行同一张 FEX 图并记录人工评分
2. 继续缩小 `layout-replication.executor` 职责，让它只做编排
3. 将参考图复刻完成判定继续接入更上层任务报告，让用户看到“未执行成功 / 部分执行 / 需复核”的明确状态；已完成的防假成功规则必须保持在 preflight 中
4. 继续扩展 Photoshop style recipe：`stroke 描边` MVP 已接入，下一步进入真实手测和 `shadow 投影`
5. 建立截图级 QA 雏形：当前已完成 bounds 级视觉几何对比，并已接入显式 overlay 截图观察入口；下一步是用真实 Photoshop 任务校验 overlay 产物是否稳定
6. 将 QA 结果回写到用户可读报告，避免只说“已完成”

验收口径：

1. 至少有 2 到 3 个真实参考图 case
2. 每个 case 有人工期望、输入素材、执行结果、失败点记录
3. 复刻结果必须是可编辑图层，不只是扁平图像
4. 结果报告必须区分结构相似、样式相似、图片落位、未实现效果
5. 执行器不能把无匹配、部分失败或零成功调整报告为完成

### P0：Photoshop 验收与 Debug 发现工具

这是本轮新增规划主线，当前已先实现轻量 snapshot / diff MVP，并已接入普通 Photoshop 写操作的 before / after 快照与差异记录。截图叠加、项目级报告和真实 Photoshop 手测仍未完成。

目标：让 Agent 和开发者能可靠知道 Photoshop 中真实发生了什么，而不是只相信模型计划或工具返回的“成功”。

为什么必须做：

1. 设计 Agent 的能力上限取决于它能否感知真实 Photoshop 状态。
2. 当前模型只要有工具就能做更多事，但缺少验收工具会导致“看似执行了，实际没成功”。
3. 后续开发如果没有统一验收标准和可重复检查结果，问题会变成主观争论，无法定位。
4. 让 Codex / Agent 参与验收，需要结构化运行记录与检查报告，而不是只看用户截图。

MVP 能力范围：

1. 读取 Photoshop 当前状态
   - 打开文档列表
   - 当前文档尺寸、颜色模式、图层数量
   - 图层树、图层类型、图层 bounds、可见性、锁定状态
   - 文本图层内容、字体、字号、颜色
   - 图片/形状图层 bounds 与不透明度
2. 执行前后快照
   - 工具调用前 snapshot
   - 工具调用后 snapshot
   - diff 出新增/删除/移动/样式变化
   - 标记“工具返回成功但文档无变化”的可疑情况
3. 视觉截图对比结果
   - 获取整张文档或指定屏幕截图
   - 可叠加目标框 / 实际框 / 偏差框
   - 支持导出验收图和 JSON 报告
4. 项目级验收
   - build / smoke / benchmark / UXP build 汇总
   - Photoshop 连接状态
   - UXP 插件版本与工具可用性
   - 最近错误日志、慢工具、失败工具统计
5. Debug 挖掘
   - 自动找出工具调用失败、返回空、返回成功但无变化、图层越界、图层重叠、字体未变更、图片落位偏差
   - 生成可复现报告，包含用户请求、模型决策、工具序列、前后快照、错误日志

当前已落地：

1. UXP 侧 `getAcceptanceSnapshot`：读取文档、图层、文字、边界、选中状态。
2. MCP Host `photoshop.acceptance_snapshot`：提供直接验收快照入口。
3. Agent 工具提示 `getAcceptanceSnapshot`：让模型可在规划时选择验收快照。
4. 共享 diff helper：可离线比较新增、删除、文字、几何和样式变化。
5. Smoke：`npm run smoke:acceptance:snapshot-diff`。
6. 写操作前后自动验收：普通 Photoshop 写工具会返回 `acceptance` 检查摘要。
7. 自适应性能策略：文本类采集内容读回，图片类优先 bounds，大批量类提高图层预算，深度验收需显式启用。
8. 用户可读验收摘要：工具结果中的 `acceptance.summaryText` 会说明检测到的变化、无变化风险或快照失败原因。
9. 普通反馈脱敏：模型上下文、工具结果块和调试报告优先显示摘要，不再默认把完整工具 JSON 暴露给普通用户。
10. Smoke：`npm run smoke:tool-result:redaction` 已覆盖普通反馈路径的 raw JSON 退化风险。
11. Debug Bridge / MCP debug session 默认脱敏：HTTP 和 MCP 读取调试会话时返回 summary，不返回完整 metadata、trace、toolCalls、errors。
12. 完整调试读取门禁：只有配置 `DESIGNECHO_DEBUG_TOKEN` 且调用方提供正确 token 时，才允许读取完整 session。
13. Debug Bridge / MCP debug session 的脱敏 message summary 会保留 `executionSummary` 的状态、工具/验收计数、blocker/warning 数量和 `summaryText`，但不会暴露完整 `lastError`。
14. Smoke：`npm run smoke:debug-bridge:redaction` 已覆盖 token 门禁、CORS 边界和 `executionSummary` 脱敏摘要。
15. 字体修改任务级断言 MVP：`setTextStyle` 带 `fontName` 时会验证目标文本图层的 after 快照字体是否匹配，并在用户摘要中显示通过、失败或需复核。
16. 文本内容任务级断言 MVP：`setTextContent` 带 `content` 或 `updates` 时会验证目标文本图层 after 快照中的内容是否匹配，并在显式目标失败时标记失败、隐式目标不明确时标记需复核。
17. 失败工具防伪验收：工具返回 `success: false` 时，验收快照只用于诊断，不会把任务标记为 `verified=true`。
18. 显式目标缺失防伪验收：显式文本目标不存在或不是文本图层时，字体/文本内容断言会失败，而不是降级成“需复核”。
19. 关闭文档任务级断言 MVP：`closeDocument` 会验证执行前活动文档在执行后是否离开；活动文档未变则失败，目标不是活动文档时需复核。
20. 移动图层任务级断言 MVP：`moveLayer` 会验证显式目标或唯一选中图层的 after bounds 是否到达期望 left/top；多选且无显式目标时需复核。
21. 只读 live smoke：`smoke:photoshop-acceptance:live` 可在已连接 UXP 插件时验证 `photoshop.acceptance_snapshot` 与 `getAcceptanceSnapshot` 两条入口真实可用。
21. 写入型 live smoke：`smoke:photoshop-acceptance:write-live` 可在一次性文档中验证创建文档、创建中文文本、修改文本、移动图层、关闭不保存和切回原文档，且不纳入默认预检。
22. 文档保存/关闭磁盘 live smoke：`smoke:photoshop-document:save-close-live` 可在一次性文档中验证 `saveDocument(path)` 真实写出 PSD，并验证 `closeDocument(save:false)` 不会把关闭前的未保存修改再次写盘。

当前未落地：

1. 截图叠加目标框 / 实际框 / 偏差框的真实任务手测与统一报告 UI。
2. 项目级 JSON / Markdown 验收报告。
3. 真实 Photoshop 手测样本仍不足；目前已有轻量只读 live smoke、一次性文档写入 live smoke 和文档保存/关闭磁盘 live smoke，但还缺大文档、复杂图层和真实用户流程样本。
4. 用户界面中的验收报告展示。
5. 更多任务级断言，例如图片替换和模板生成。
6. Debug Bridge 与 MCP debug session 的真实开发工具接入体验仍待手测。
7. 中文字体显示名、PostScript fontName、字体别名之间的真实映射仍未建立，字体断言目前只做规范化名称匹配。
8. 文本内容断言仍是结构化文本字段对比，不等于视觉排版质量判断；多行、空格和特殊字符场景需要真实样本继续验证。
9. `closeDocument` 断言已补充一次性文档保存/关闭磁盘 live smoke，但普通任务报告中的 save/no-save 磁盘状态还没有进入 UI 展示闭环。
10. `moveLayer` 断言只证明几何坐标符合参数，不证明这个位置符合设计审美、主体构图或参考图复刻质量。
11. 参考图复刻视觉几何 QA 目前只比较计划 bounds 与实际 Photoshop bounds，不等于截图相似度、像素差异、主体裁切质量或审美判断。

体验与性能原则：

1. 验收不能显著拖慢普通操作。
2. 默认只采集结构化读回，不读取像素。
3. 面向用户展示摘要和风险，不展示完整内部 JSON。
4. 需要更深入的视觉检查时使用显式深度模式，而不是每次都重扫。
5. 性能优化不能以牺牲任务质量和验收真实性为代价。

不在 MVP 承诺：

1. 不承诺自动判断所有设计美丑。
2. 不承诺 100% 还原 PSD 制作过程。
3. 不承诺完全自动修复所有 Photoshop 异常。
4. 不把截图级相似度误写成专业设计师审美评价。

建议模块：

1. UXP 侧：`acceptance-tools`
   - `getAcceptanceSnapshot`
   - `captureAcceptanceScreenshot`
   - `diffAcceptanceSnapshots`
   - `auditLayerBounds`
   - `auditTextLayers`
2. Agent 主进程：`photoshop-acceptance-service`
   - 统一调用 UXP 验收工具
   - 收集工具日志、模型决策、项目状态
   - 生成验收报告
3. Renderer：验收报告面板
   - 展示通过/警告/失败
   - 支持展开 Photoshop 运行与读回详情
   - 支持导出 JSON / Markdown
4. CLI / smoke：验收脚本
   - `npm run acceptance:photoshop:smoke`
   - `npm run acceptance:project`
   - `npm run smoke:photoshop-acceptance:live`
   - `npm run smoke:photoshop-acceptance:write-live`

MVP 验收场景：

1. 字体替换：执行后所有文本图层字体真的变化
2. 关闭文档不保存：文档列表真的减少，且没有保存动作
3. 参考图复刻：新增图层数量、分组、bounds、截图对比结果可读
4. 图片替换：目标图层 bounds 与计划 bounds 偏差在阈值内
5. 局部重绘：返回图层不是空白，不是全白 alpha，选区区域有有效像素变化

### P0：Photoshop 工具语义底座（文本工具优先）

这是新增基础设施规划，不是单一业务功能。目标是让 Agent 真正理解并可靠使用 Photoshop 高频工具，而不是只知道“有一个工具可以调用”。当前已经落地文本工具语义 catalog MVP，但它仍是语义与验收基础设施，不等于完整文本排版能力已经完成。

为什么必须做：

1. 设计质量很大程度取决于工具参数是否被正确理解，例如文字工具的字体、字号、字距、行距、对齐、标点、换行、视觉 bounds 与文本框 bounds。
2. 当前 Agent 已能调用部分工具，但很多工具还停留在“能执行”层面，缺少语义定义、参数约束、失败条件、验收方式和真实案例。
3. 文本是电商设计、平面设计、详情页、主图、SKU 中最高频的可编辑元素；文本工具不可靠，会直接影响参考图复刻、模板生成、文案优化和最终设计质感。
4. 这层能力应服务所有设计任务，而不是只服务详情页或 FEX case。

第一阶段优先做文本工具语义：

已落地的 MVP 事实：

1. 已新增 `PhotoshopToolSemantics` 共享数据源，先覆盖文本创建、内容修改、样式修改和视觉 bounds。
2. 已新增 `smoke:photoshop-tool-semantics`，并纳入维护预检，防止 catalog 字段缺失或工具覆盖退化。
3. 已新增 `benchmarks/photoshop-tool-semantics/text-tool-cases.json` 和 `smoke:photoshop-text-tool-benchmarks`，覆盖多行中文、参数标点、左右列、字体 fallback、字距/行距、价格促销和视觉 bounds 校正的离线契约。
4. `setTextStyle` 任务级验收已从 `fontName` 扩展到 `fontSize`、`tracking`、`leading`，并覆盖通过、失败、字段无法读回需复核三类 smoke。
5. 已新增 `smoke:photoshop-text-tools:live`，用于在连接 Photoshop + UXP 时创建一次性文档，执行文本创建、批量内容修改、左右列排版、字距/行距、价格文案和基线 bounds 校正，并关闭文档不保存。
6. 已新增 UXP 共享字体解析模块 `DesignEcho-UXP/src/tools/text/font-resolver.ts`，并新增只读工具 `resolveFontName`，用于在写入前解析显示名/PostScript 名/family/style，解析失败时返回候选建议而不是直接写入 Photoshop；resolver 已改为缓存字体列表并避免直接调用不稳定的 `app.fonts.getByName`。
7. `createTextLayer` 和 `setTextStyle` 已改为复用字体 resolver；`createTextLayer` 收到 `fontName` 时会先解析，成功后写入 `fontPostScriptName`，失败则返回明确错误和建议。
8. 文本工具语义 catalog 已以受控摘要接入 autonomous Agent 的系统规划提示；提示中同时保留边界说明，明确字段级读回不等于截图级排版质量或参考图保真。
9. `setTextStyle` 的 `fontSize/tracking/leading` 字段级 live 检查已通过：写入行距时同步关闭 `autoLeading`，`getTextStyle` 增加 Action Manager descriptor 读取路径，最新 live smoke 为 87 项通过、0 失败、0 需复核。
10. 文案优化面板已从“调整方向 chip”升级为结构化输入契约：内容场景、文案角色、优化目标、禁用词、最多字数、上一轮具体反馈会从 WebView 经 UXP 转发到 Agent `optimize-text`，并由提示词与候选过滤消费。
11. 文案优化候选区已升级为候选分析卡片：Agent 侧为每条候选生成 `candidateDetails`，包含 `fitStatus/fitLabel/lengthDiff/risks/preservedKeywords/missingKeywords/forbiddenHits/goals`；WebView 展示字数差、目标、保留词与风险，不依赖模型严格输出 JSON。`smoke:text-optimization:contract` 覆盖输入契约和候选详情字段。
12. 已新增图文文案创作框架共享模块和 smoke：文案生成必须先判断视觉锚点、产品事实、用户场景和产品解决的问题，缺少依据时不能编造画面、功能、材质、场景或用户痛点；该框架已接入 `optimize-text` 提示词和本地设计知识检索。
13. 当前边界是：这不是完整文案工作流闭环，尚未完成替换前后视觉验收、回滚、OCR、长详情页分屏识别、法律合规审查，也不能替代真实视觉模型对图片内容的识别。

详细语义继续细分为：

1. 字体语义
   - 显示名、PostScript 名、字体族、字重、中文字体别名之间的映射。
   - 字体缺失、字体替代、字体不可用时的明确反馈。
   - 常用中文字体、英文字体和品牌字体的可用性探测。
2. 字号与视觉尺寸
   - 区分 Photoshop fontSize、视觉黑色像素高度、文本框高度、boundsNoEffects。
   - 建立字号估算、创建后 bounds 校正和验收阈值。
   - 记录不同字体下同字号的实际视觉差异，避免用坐标硬修字体问题。
3. 排版细节
   - 字距、行距、段前段后、对齐方式、文本框宽高、自动换行、手动换行。
   - 中文标点、英文标点、冒号、斜杠、连字符、百分号、空格和全半角差异。
   - 多行文本、左右列文本、表格型文本、标签型文本、标题/副标题/正文层级。
4. 执行与验收
   - `createTextLayer`、`setTextContent`、`setTextStyle`、`moveLayer`、`getLayerBounds` 的组合式 recipe。
   - 每次文字写操作应有 before/after 读回，至少验证内容、字体、字号、bounds。
   - 需要区分“结构文本正确”“视觉排版接近”“字体字形仍需复核”。

第二阶段扩展到其他高频工具语义：

1. 选择 / 选区工具：选区来源、边界、羽化、反选、保存选区、选区与图层 bounds 的关系。
2. 移动 / 对齐 / 分布：相对移动、绝对位置、参考点、成组移动、对齐对象和画布安全区。
3. 自由变换 / 智能缩放：缩放比例、等比约束、视觉主体保护、裁切策略、参考图目标框。
4. 图层样式：描边、投影、内阴影、发光、渐变叠加、混合模式、透明度。
5. 蒙版 / 剪切蒙版：目标图层、被剪切层、蒙版 bounds、可见像素、非破坏编辑。
6. 形状工具：矩形、圆角、椭圆、线条、路径、填充、描边、像素对齐。
7. 图像放置 / 替换：智能对象、普通像素层、目标框、cover/contain、主体裁切。

每个工具语义条目必须包含：

1. 工具名称和适用场景
2. 参数 schema 与单位
3. Photoshop 实际执行方式
4. 与图层、画布、选区、bounds 的关系
5. 常见失败条件
6. 可重复质量检查
7. 性能影响
8. 最小 smoke / benchmark / live 手测 case

当前事实：

1. 文本工具已有部分基础：`setTextStyle`、`setTextContent`、`createTextLayer` 的 acceptance 断言已经存在。
2. `PhotoshopToolSemantics` catalog MVP 已存在，但目前只覆盖文本工具最小语义，不等于完整 Photoshop 工具体系。
3. 文本工具 benchmark 已有离线契约，并已有一次性真实 Photoshop live smoke 初版。
4. 最新已验证 live smoke 结果为 `pass`：连接成功、一次性文档关闭成功、12 个文本层创建，87 项通过、0 项需复核、0 项失败。
5. `resolveFontName` 已在用户重载 UXP 后证明可把 `思源黑体` 解析为 `SourceHanSansSC-Normal`，并由 `setTextStyle` 成功写入 resolved PostScript 字体；`fontSize=26`、`tracking=40`、`leading=36` 已能读回。
6. 已新增缺失字体安全失败 benchmark 和 live smoke 用例；本轮 live 验证暴露 resolver 旧逻辑会因为字体 style 得分把不存在字体误匹配到 `NotoColorEmoji-SVG`，已修正为“必须先命中字体名称，再按字重排序”。该修复需要 Photoshop 内的 UXP 插件重新加载后才能完成 live 复验。
7. FEX 文本复刻已暴露字体字形和实际 bounds 差异问题，证明文本工具语义还不够完整。
8. 当前字段级字体/字号/字距/行距检查已通过；剩余风险是更多字体族、缺失字体 live 复验、截图级排版质量和参考图完整复刻。

验收口径：

1. 能解释并验证“字体已经改了但视觉看起来没变 / 没改成功”的差异原因。
2. 能对多行中文文本、标点、换行、行距、字距做真实 Photoshop 验收。
3. 文本参考图复刻至少覆盖标题、左右列字段、长句、多行段落、价格/促销文案。
4. 工具失败不能被包装为成功；字体替代、bounds 偏差、换行不一致必须进入需复核。
5. 新增工具语义不能破坏现有可用功能，必须纳入维护边界和 smoke。

### P0：Agent 基础设施收口

当前状态：`maintenance:agent-architecture` 报告为 `mvp_ready_not_complete`。这意味着基础设施已经能支撑继续开发，但不能宣称完整完成。当前必须把 Agent 底座从“最小可用”推进到“可持续开发所需的最低完整度”。

当前实施与验收入口：`project-memory/Plan.md`、`docs/agent-capability-map.md`。

收口顺序：

真实 UI 自动化当前实现：已具备隔离 Electron ChatPanel smoke，覆盖确定性 `/help`、模型身份问题、普通设计聊天问题、关闭文档不保存、保存详情页文档到项目 PSD、失败验收 `executionSummary` 样本；文档操作使用测试专用 Photoshop 工具桩，失败验收使用测试专用 fake model 和 fake Photoshop 工具结果，不触碰真实文档。测试桥接快照已暴露 `executionStatus` / `executionSummaryPreview` 供 smoke 断言任务报告状态。仍需继续扩展到 live API 质量样本和真实 Photoshop destructive 操作验收。

1. 真实 UI 自动化验收：验证 ChatPanel 真实窗口中不会出现 debug JSON、伪 thinking、失败伪完成。
2. 全局流式输出与步骤可观测性：让普通聊天、确定性 skill、自主工具链和失败任务都能显示事实步骤、工具调用、验收摘要和阻塞原因；不展示私有 chain-of-thought，不用伪思考代替真实事件。
3. 截图级 QA 最小闭环：把 overlay / screenshot 检查摘要进入任务报告，不把 base64 放进模型上下文。
4. 工具语义底座扩展：从文本工具扩展到移动、对齐、图像放置、形状和图层样式。
5. 设计网格 DSL 与任务网格预设：把排版约束转成 liveArea、margin、gutter、column span、baseline、spacing token。
6. 统一设计知识入口：把网页搜索、设计参考、趋势感知、本地 recipe 统一为带来源记录的结果。
7. 多 Agent 任务生命周期：让 teammate task 具备可恢复状态、运行记录和 Critic 验收要求。

验收口径：

1. 每一项基础设施都必须有 smoke 或 live smoke。
2. 每一项都必须明确“能证明什么 / 不能证明什么”。
3. 不以业务功能数量判断底座完成，而以路由、执行、运行记录、质量报告、恢复和维护边界判断完成。

### P0：网格排版 DSL 与任务网格预设

来源文档：`docs/layout-grid-design-knowledge.md`

定位：这是排版底座，不是立即改变设计结果的业务功能。先纳入规划和真相源，后续再谨慎接入执行器。

目标：

1. 把“模型猜位置和大小”升级为可计算约束。
2. 建立 `DesignGridSpec`：canvas、liveArea、columns、gutter、margins、rows、baseline、spacingScale、confidence、source。
3. 建立 `GridPlacementConstraint`：元素对应 column span、row、baseline、snap tolerance、是否允许 break-out。
4. 给不同任务提供不同网格预设，而不是硬编码 12 栏。

任务预设优先级：

当前实现：已新增 `src/shared/design-grid-dsl.ts` 和 `npm run smoke:design-grid-dsl`；目前只提供真相源、预设与评分，不改变执行器效果。

1. `text-certificate`：合格证、吊牌、纯文字信息图，优先使用列组和基线网格。
2. `sku`：重复单元格网格，优先保证色块、文字标签、组合块一致。
3. `detail-page`：模块级 4/8 栏与垂直节奏。
4. `reference-replication`：从参考图推断 liveArea、列、行、gutter、baseline。
5. `main-image`：只作为安全区、重心和 CTA 局部网格，不强制限制主视觉创意。

明确不做：

1. 不把所有设计强制吸附到同一个网格。
2. 不把网格推断低置信度的参考图伪装成成功。
3. 不用网格替代字体、图片裁切、光影、风格 recipe 和截图级 QA。
4. 不在没有 smoke 前直接修改 `layout-replication-apply` 的落地效果。

验收：

1. 新增 Grid DSL 真相源和 smoke。
2. smoke 覆盖 spacing scale、任务预设、网格推断输入输出边界。
3. 后续接入执行器前，必须能输出 `gridFitScore` 和 off-grid 元素说明。

### P1：图像模型管理重构

目标：让设置页“图像处理”中的模型状态、下载、安装、验证都可信。

内容：

1. 单一模型 catalog
2. 单一模型安装目录
3. 主进程 registry service
4. 下载后校验与加载探测
5. 设置页状态来自后端真实扫描

验收：

1. UI 显示已安装时，磁盘文件真实存在且校验通过
2. UI 显示可用时，后端加载探测通过
3. 下载失败、文件损坏、路径不一致都能明确显示

### P1：首批 Photoshop visual recipe

目标：让参考图复刻的高频视觉效果不再完全依赖模型临场发挥。

建议顺序：

1. `stroke 描边`：MVP 已接入参考图复刻模板落地和匹配校验，已有 bounds 级 QA 结果，仍需真实 Photoshop 手测和截图/overlay 级验证
2. `shadow 投影`：MVP 已接入参考图复刻模板落地和匹配校验，当前只执行单独 shadow 的柔和投影；同层 `stroke+shadow` 暂跳过 shadow，仍需真实 Photoshop 手测和图层效果合并验证
3. `rounded-card 圆角卡片`
4. `badge 标签组件`
5. `gradient 渐变背景`

每个 recipe 必须包含：

1. 参数 schema
2. Photoshop 执行方式
3. 可支持范围
4. 失败条件
5. 验收规则

### P1：真实 Photoshop 手测样本库

目标：把用户验收变成可记录资产。

内容：

1. 参考图复刻 case
2. 字体替换 case
3. 图片替换 / 智能缩放 case
4. 局部重绘 case
5. 抠图 case

每个 case 必须记录：

1. 输入文档或素材
2. 用户需求
3. 期望结果
4. 执行输出
5. 验收报告
6. 人工结论

### P1：设计知识网页搜索与来源记录

目标：让 Agent 可以在需要时获取设计趋势、案例、规范和 recipe 线索，并把来源、引用、缓存和用途边界记录清楚。

当前事实：

1. 项目已有 `design-reference-search` skill、`searchDesigns`、`fetchWebPageDesignContent` 和 `TrendSensingService`。
2. 已新增 `DesignKnowledgeSearchService` MVP 和共享 `DesignKnowledgeResult` schema；当前只读接入本地 Photoshop style recipe 与设计领域手工规则，并提供外部知识结果归一化函数，不联网、不执行 Photoshop。
3. 设计参考搜索、网页抓取、趋势感知当前仍未接入真实 provider；只能先通过归一化函数进入 `DesignKnowledgeResult`，不能算完整可靠知识层。
4. 小米 MiMo 官方 Web Search 支持 `web_search` provider-native tool，并返回 `annotations / url_citation` 与 `web_search_usage`。
5. 当前 provider adapter 只支持 function tools，不能直接把小米 `type: "web_search"` 原样纳入通用工具 schema。
6. DeepSeek 官方 `deepseek-v4-pro` 已作为文本/推理/Tool Calls provider 接入；这不等于外部设计知识搜索已经完成，也不等于搜索结果已标准化为可追溯来源记录。

建议路线：

1. 扩展 `DesignKnowledgeSearchService`，把现有搜索、指定网页抓取、趋势感知和本地知识逐步统一成 `DesignKnowledgeResult`。
2. 为小米 MiMo 增加 provider-native Web Search 适配，只在官方支持模型和用户开启设置时启用。
3. 搜索结果只能作为设计上下文、来源记录和 recipe 线索，不能直接生成 Photoshop 执行动作。
4. 用户界面必须展示摘要、引用和成本/插件开关风险，不默认暴露 raw JSON 或 raw HTML。

验收：

1. 搜索结果包含来源、引用、获取时间、用途边界和置信度。
2. 小米 Web Search 请求体只在 `xiaomi` 且模型支持时包含 `type: "web_search"`。
3. 非小米模型不会收到小米专属 tool。
4. 搜索未发生、插件未启用、模型不支持、无 API Key、网页抓取失败都能明确区分。
5. 不把搜索摘要误写成“设计效果已验证”。

## 5. 未来愿景，但当前未实现

这些是合理愿景，但现在不能写成已完成能力。

### 5.0 通用 Photoshop 设计 Agent

愿景：用户提出任意合理设计任务，Agent 能理解目标、判断需要哪些素材和 Photoshop 操作，生成可编辑结果，并用运行摘要、质量检查和读回差异说明完成度、偏差及下一步修正。

当前缺口：

1. 设计 DSL、工具语义、验收、知识、recipe 和多 Agent 还没有形成完整闭环。
2. 现有业务场景仍较碎片化，主图、SKU、详情页、参考图复刻之间还没有完全复用同一套设计能力底座。
3. 当前 benchmark 只能验证局部能力点，不能代表整体设计能力。
4. 真实用户需求样本还不够多，意图理解和任务拆解仍需要持续评估。

### 5.1 一句话生成完整电商设计

愿景：用户一句话说目标，Agent 自动完成主图、详情页、SKU、文案、排版、导出。

当前缺口：

1. 缺少稳定设计 DSL
2. 缺少真实 recipe 库
3. 缺少跨页面风格一致性系统
4. 缺少完整验收工具

### 5.2 高保真参考图复刻

愿景：用户给一张参考图，Agent 生成高度相似、可编辑、可复用的 Photoshop 设计。

当前缺口：

1. benchmark 只有第一个 FEX 文本排版真实案例，样本覆盖仍不足
2. screenshot QA 仅完成 bounds 级视觉几何 MVP，尚未完成截图/overlay 级相似度闭环
3. 高级样式 recipe 未落地
4. 图片智能缩放和主体保护仍需真实验证

### 5.3 多 Agent 设计团队

愿景：Planner、视觉分析、文案、执行、Critic 多角色协作。

当前缺口：

1. 已有最小 `design-teams` coordinator / registry / task / shared types
2. 已有 `delegateToAgent` 工具入口
3. 已有四类 teammate：`scene-analyst / design-strategist / executor / critic`
4. 但还缺完整任务生命周期、持久化任务队列、跨 teammate 编排策略和 Critic Photoshop 验收闭环
5. 多 Agent 不能替代基础工具可靠性

当前架构体检：

1. `maintenance:agent-architecture` 将该 gate 标记为 `mvp`。
2. 这意味着当前只能说“多 Agent 最小基础设施存在”，不能说“多 Agent 设计团队闭环已完成”。

### 5.4 设计知识库 / RAG / 多模态案例库

愿景：系统拥有品牌、电商、平面设计、优秀案例、recipe、视觉参考库。

当前缺口：

1. 尚无向量模型与索引系统
2. 尚无视觉案例结构化 schema
3. 尚无 recipe 与案例联动机制
4. 当前应先做轻量结构化知识，不直接上重型图谱
5. 网页搜索只能补充外部知识和来源记录，不能替代本地 recipe、DSL、Photoshop 验收和 benchmark

### 5.5 自动 Debug 与自我修复

愿景：Agent 发现自己做错了，自动定位原因并修复。

当前缺口：

1. 需要 Photoshop 验收工具提供真实对象读回与状态检查
2. 需要工具调用日志和状态 diff
3. 需要错误分类和可复现报告
4. 需要安全回滚或局部重试机制

## 6. 明确不承诺的内容

1. 不承诺从一张扁平图 100% 还原原作者 PSD 图层历史。
2. 不承诺没有真实 Photoshop 验收就判断“已成功”。
3. 不承诺复杂审美判断完全自动化。
4. 不承诺通过硬编码 prompt 修复系统性理解问题。
5. 不承诺在 benchmark 缺失时宣传复刻能力成熟。

## 7. 分阶段路线图

### M0：项目状态与工程卫生

状态：进行中，已完成大部分基础。

目标：保证项目可恢复、可维护、可验证。

### M0.5：Agent 能力地图与场景边界

状态：进行中，已新增初版能力地图。

目标：把项目从碎片化功能列表重新整理成能力地图，明确 Agent 基础设施、Photoshop 操作能力、设计理解能力、设计执行能力、业务场景和 benchmark 之间的关系。

来源文档：`docs/agent-capability-map.md`

近期最小目标：继续把现有 skill、MCP/tool、benchmark 和业务场景回填到能力地图，标注每项能力的状态、实现位置、验证结果、依赖、边界和对应 smoke / live smoke；主图、SKU、详情页、参考图复刻只能作为业务场景或验收样本挂在能力地图下。

### M1：参考图复刻最小闭环

状态：进行中。

目标：完成参考图解析、DSL、blueprint、可编辑落地、基础 QA。

当前下一步：用 `rr-001-fex-certificate-text-layout` 走真实 Agent UI/模型解析流程做复刻执行与评分，重点复核任务报告状态、文字 bounds、字号、行距、左右列位置；随后研究受控字体选择/字体映射，解决 live 诊断中截图像素探针 watch 暴露的字形/抗锯齿差异，同时继续瘦身 executor。

### M2：Photoshop 验收工具 MVP

状态：进行中，已完成轻量 snapshot / diff MVP、普通写操作 before / after 快照与差异记录、用户可读验收摘要、普通反馈脱敏、Debug Bridge / MCP debug session 默认脱敏、完整读取 token 门禁、Debug Bridge `executionSummary` 脱敏摘要接入、文本/字体/关闭文档/移动图层任务级断言 MVP、只读和写入型 Photoshop live smoke、ChatPanel 到消息渲染的代码级执行链路 smoke、Agent runtime 运行结果摘要，以及消息级任务报告卡片。

目标：建立前后快照、截图对比、状态 diff、项目验收报告。

这是后续所有设计能力继续扩展的基础设施。

### M2.5：Photoshop 工具语义底座

状态：进行中，文本工具语义 catalog MVP 已建立，并已纳入本地 smoke 与 preflight；文本工具已有部分 acceptance 结果和 FEX 文本落位诊断记录。

目标：把 Photoshop 高频工具从“能调用”推进到“Agent 能理解参数、限制、失败条件和验收方式”。第一阶段优先文本工具，包括字体、字号、字距、行距、标点、换行、文本框、视觉 bounds 和字体替代；第二阶段扩展到选区、移动、对齐、自由变换、蒙版、图层样式、形状和图像放置。

当前已落地：

1. `src/shared/photoshop-tool-semantics.ts`：统一记录文本工具的语义、参数、常见失败模式、验收要求和边界。
2. MVP 条目：`text-layer-create`、`text-content-edit`、`text-style-edit`、`text-layout-bounds`。
3. 覆盖工具：`createTextLayer`、`setTextContent`、`setTextStyle`、`resolveFontName`、`moveLayer`、`getLayerBounds`、`getAcceptanceSnapshot`。
4. `src/renderer/services/agent-runtime/tool-schemas.ts` 与 `src/renderer/services/tool-executor.service.ts`：已同步文本相关工具的 Agent 可见参数，避免模型看不到 `layerId/fontName/tracking/leading/baselineContent/includeEffects` 等真实支持能力；`resolveFontName` 已作为只读字体解析工具暴露给 Agent。
5. `benchmarks/photoshop-tool-semantics/text-tool-cases.json`：新增 7 个文本工具 benchmark 场景，覆盖多行中文、参数标点、左右列合格证、字体 fallback、字距/行距、价格促销和基线/bounds 校正。
6. `npm run smoke:photoshop-tool-semantics`：验证文本语义条目、工具覆盖、字体 fallback、标点/换行、视觉 bounds、验收字段，以及 Agent 可见 schema 的关键参数。
7. `npm run smoke:photoshop-text-tool-benchmarks`：验证文本 benchmark 与语义 catalog 的对应关系；该 smoke 不调用 Photoshop，不宣称 live 质量。

近期最小目标：字体解析和行距字段检查已通过；缺失字体误匹配 bug 已修复并加入 benchmark/live smoke。2026-04-29 继续发现缺失字体路径仍可能因重复扫描 Photoshop 字体集合超时，已改为单次扫描并禁止 fuzzy suggestion 升级为 resolvedFont；该修复已构建并通过静态 smoke，但因为构建发生在本次 UXP 重载之后，仍需要下一次 UXP 重载后做 live 复验。文本工具语义已接入 autonomous Agent 规划提示，下一步补更多真实字体、多行段落框、颜色/对齐和截图级排版检查，并把同样的边界传递到用户可见任务报告。必须保持边界：字段级通过不等于截图级排版质量通过。

### M3：首批 visual recipe

状态：规划中。

目标：先实现描边、投影、圆角卡片、标签等高频效果。

### M4：截图级 QA 与设计回路

状态：进行中。

目标：从结构 QA 走向视觉 QA，支持“生成-比对-修正”。当前已完成 bounds 级视觉几何 MVP，并已把 UXP 截图/overlay 观察接入显式深度验收路径；下一步是真实 Photoshop 手测、阈值校准和报告 UI。

### M5：轻量知识系统

状态：MVP 进行中。已新增网页搜索可行性研究、设计知识搜索路线、网格排版知识落地规划，并落地 `DesignKnowledgeSearchService` 本地 recipe / 领域规则 / 图文文案框架只读入口与外部结果归一化边界。

目标：建立设计规则、recipe、视觉案例、外部网页来源的轻量检索系统。

近期最小目标：继续把设计参考搜索、网页抓取、趋势感知接入已建立的 `DesignKnowledgeResult` 归一化入口，再接小米 MiMo Web Search provider。

### M6：多 Agent 任务系统

状态：MVP 存在但不完整。已有最小 coordinator / registry / task / shared types；尚未完成任务生命周期、持久化队列和 Critic Photoshop 验收闭环。

目标：让设计任务具备正式的计划、执行、复核、修正生命周期。

## 8. 近期建议执行顺序

当前优先级调整：先补 Agent 基础设施底座，再继续扩大业务能力。

1. 建立 Agent 能力地图，把基础设施、Photoshop 操作能力、设计理解能力、设计执行能力、业务场景和 benchmark 分层，先解决当前碎片化问题。
2. 完成真实 UI 自动化验收最小闭环，验证 ChatPanel 真实窗口中的路由、任务报告、脱敏和失败状态。
3. 继续推进全局步骤可观测，让普通聊天、确定性 skill、自主工具链和失败任务都显示事实步骤。
4. 将 Grid DSL 纳入共享真相源和 smoke，只建立规划与约束，不直接改变排版执行效果。
5. 扩展 PhotoshopToolSemantics 到移动/对齐/图像放置/形状/图层样式，继续保持文本工具优先验收。
6. 用首个真实参考图 benchmark case 执行 Photoshop 复刻并记录结果截图、失败点和评分；该 benchmark 只验证文本排版与链路，不代表完整设计能力。
7. 建立截图级 QA 的最小报告入口：bounds 级几何对比与显式截图/overlay 入口已完成，继续做真实手测和报告 UI。
8. 扩展 `DesignKnowledgeSearchService`，把当前设计参考搜索、网页抓取和趋势感知输出统一进 `DesignKnowledgeResult`。
9. 为小米 MiMo Web Search 做 provider-native tool 适配和成本/插件开关提示。
10. 继续拆 `layout-replication.executor`，让它只负责编排而不是混合推理。
11. 复验首批 Photoshop style recipe：`stroke` 与 `shadow` 都已接入代码级 MVP，下一步需要真实 Photoshop 手测、截图/overlay 级验证和图层效果合并验证。
12. 手测 Debug Bridge token 门禁是否满足开发调试体验。

历史顺序保留为背景，但执行时以上述顺序为准。

1. 将 `getAcceptanceSnapshot` 接入关键写操作的 before / after 快照链
2. 用首个真实参考图 benchmark case 执行 Photoshop 复刻并记录结果截图、失败点和评分
3. 基于已建立的 `PhotoshopToolSemantics` 文本 catalog，补齐文本工具 benchmark / live case，并谨慎接入 Agent 规划与验收
4. 继续拆 `layout-replication.executor`
5. 实现 `stroke 描边` recipe 的端到端执行与验收
6. 增加截图级 QA 的最小版本：bounds 级几何对比与显式截图/overlay 入口已完成，继续做真实手测和报告 UI
7. 扩展 `DesignKnowledgeSearchService`，统一当前设计参考搜索、网页抓取和趋势感知输出
8. 为小米 MiMo Web Search 做 provider-native tool 适配和成本/插件开关提示
9. 基于已建立的 ChatPanel 测试桥接入口实现真实 Electron 自动化，再手测 Photoshop 当前路由/复刻边界
10. 手测 Debug Bridge token 门禁是否满足开发调试体验

## 9. 项目治理规则

### 9.1 新想法进入计划，而不是直接插队

用户的新想法必须先进入计划系统，再决定执行顺序。记录时必须标明：

1. 它解决什么真实问题
2. 属于当前主线、支撑基础设施、未来愿景还是暂停研究
3. 当前是否已有可定位代码实现
4. 是否影响已可用功能
5. 需要什么验收方式

这样做的目的不是拖慢开发，而是避免项目越做越乱，也避免聊天中的想法被遗忘或被误写成已实现能力。

### 9.2 优先级可以调整，但必须留下理由

计划不是固定死的。用户提出更重要的新方向时，可以调整优先级，但必须写清：

1. 为什么调高或调低
2. 被挤下去的任务是什么
3. 是否会影响当前可用功能
4. 新顺序的最小验收是什么

### 9.3 可用功能优先保护

项目清理和架构整理不能以破坏已可用功能为代价。

任何清理类改动必须先回答：

1. 这次改动会影响哪些入口
2. 这些入口当前是否有 build / smoke / 手测覆盖
3. 如果失败，如何定位和回退
4. 是否可以分小步完成

禁止用大范围重写来掩盖局部问题。能先加验收工具和边界报告的，先加验收工具和边界报告。

### 9.4 维护性治理本身是一条主线

项目不是只要“能跑”就够。现在已经出现多套真相源、历史残留、半完成能力、功能边界混杂等问题。

维护性治理要持续处理：

1. 重复真相源
2. 未提交的大范围索引清理
3. 历史临时文件和废弃代码
4. 已实现但缺验收的功能
5. 规划文档与真实代码不一致
6. 可用但难维护的临时实现

这类工作不能和业务功能混成一个大提交。必须按维护、项目记忆、业务能力、UXP 工具、UI 状态等边界拆开。

### 9.5 每轮开发结束必须写回

每轮重要改动后，至少更新：

1. `project-memory/Status.md`
2. `project-memory/Backlog.md`
3. `project-memory/project-state.json`
4. 必要时更新 `Decisions.md` 和 `Risks.md`

写回时必须区分：

1. 已核实（代码）
2. 已核实（构建）
3. 已核实（手测）
4. 未核实 / 待验证

### 9.6 中文编码与维护命令规则

Windows PowerShell 读取 UTF-8 无 BOM 文件时，如果未显式指定编码，可能把正常中文显示成错误编码字符。后续维护时必须区分“文件真实损坏”和“Shell 读取编码错误”：

1. 读取中文项目文档时优先使用 `Get-Content -Encoding UTF8`。
2. 运行维护命令时先设置 `$OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)`。
3. 不得仅凭 PowerShell 默认输出中的乱码判断文件已损坏。
4. 真正写入中文的代码和 smoke 必须通过 `maintenance:validate` 的 mojibake scan。
5. 对用户可见的知识层、模型配置、设计规则输出，必须补充局部 smoke，防止乱码和破损模板字符串再次进入结果。

## 10. 完成判断

下一阶段不能以“代码写了很多”判断完成。必须满足：

1. 有真实 Photoshop 运行与读回结果
2. 有验收报告
3. 有失败样本和定位结果
4. 有 benchmark case
5. 有用户可理解的结果说明
6. 文档明确哪些已实现，哪些仍是规划
