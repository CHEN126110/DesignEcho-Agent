# Design Project State 与设计技能补强专项规划

> 日期：2026-06-11
> 文档权限：C 层专项规划。本文件不直接指挥开发；执行顺序与验收以 `project-memory/Plan.md` 和 `project-memory/CurrentTask.md` 为准。
> 概念依据：`docs/design-agent-blueprint-a0-a9.md`（用户蓝图）；运行时现状：`docs/design-agent-operating-system.md` 5.1.1。

## 1. 目标

把蓝图的三个核心机制落到 v3 运行时，并据此补强主图与详情页两个设计技能：

1. Design Project State：全体 Agent 共同读写的持久化项目状态（蓝图第 1 节）。
2. 角色补齐与退回路由：第一阶段 6 模块的运行时角色到齐，审核按退回规则路由（蓝图第 2、3 节）。
3. 复盘反哺：learnings 沉淀，反哺下一次设计（蓝图闭环最后一环）。

## 2. 实现红线（全程适用）

1. 蓝图中 A0 的"判断信息完整度 / 生成缺失清单 / 制定工作流"等逻辑，一律实现为模型可调用的工具与数据契约，由模型在循环内自主调用；不允许实现为代码闸门、关键词路由或绕过模型的预判。
2. 技能知识不渗透进自主循环执行器；State 的字段语义放在工具描述与技能声明层。
3. State 是证据与共享记忆，不是权限系统；写 Photoshop 的授权仍由既有执行点约束（工具决策契约、读后写纪律）负责。
4. 旧项目状态不能覆盖用户当前指令（与 M0 记忆边界一致）。

## 3. Design Project State 设计

### 3.1 契约（shared/types/design-project-state.types.ts，新增）

按蓝图基础字段定义 v0 契约，全部可选、允许部分填充：

- 标识：project_id、project_name、task_type、platform、canvas_size
- 输入侧：brand_style、target_user、product_facts、material_assets（指纹+分类摘要，不存 base64）
- 策略侧：pain_points、competitor_notes、selling_points、copywriting、visual_direction
- 执行侧：layout_plan、production_tasks、review_result、delivery_files
- 沉淀侧：learnings、version_history（V01/V02…，含每版修改原因）
- 元数据：updated_at、updated_by（角色/工具名）、schema_version: 'design-project-state/v0'

### 3.2 存储与读写

1. 位置：项目目录 `.designecho/design-state.json`（与现有 project.json 并列），UTF-8 无 BOM。
2. 读写经主进程 IPC（新增 design-state handlers），渲染侧以两个工具暴露给循环与全部队友：
   - `getDesignProjectState`（read_only_evidence）
   - `updateDesignProjectState`（增量合并写，按字段更新并自动记录 updated_by；分类为 stateful_context）
3. DesignTeamWorkspace 写穿：队友产出沉淀黑板的同时，把映射字段（scene 摘要 -> product_facts/material_assets、设计计划 -> layout_plan、评审 -> review_result 等）增量写入 State；映射关系定义在 design-teams 层，不在 Agent 运行时。
4. 主循环系统提示注入 State 摘要（有 State 时），等价于"项目记忆"；超长字段截断复用 tool-result-evidence 的策略。

### 3.3 验收口径

- 专项 smoke：契约读写、增量合并、字段截断、黑板写穿映射、旧状态不覆盖新指令的提示语义。
- 双进程 tsc + 构建 + 既有纪律套件全绿。

## 4. 角色补齐与退回路由

### 4.1 新增队友（design-teams/registry.ts）

1. `copywriter`（A4 卖点/文案策略）：只读画布 + 知识库工具；输出卖点层级与可上图文案方案（写入 State.selling_points / copywriting）；canWriteToPhotoshop=false，可并发。
2. `market-researcher`（A3 用户/市场洞察）：searchDesigns / fetchWebPageDesignContent / 知识库工具；输出痛点与市场表达摘要（写入 State.pain_points / competitor_notes）；canWriteToPhotoshop=false，可并发。

同步项：并行策略角色集合、smoke 交叉校验、execution-preflight 分类确认。

### 4.2 退回路由（蓝图第 2 节）

1. critic 裁决 JSON 增加可选 `reroute` 字段：issues[].owner ∈ {requirement, asset, insight, copy, visual, layout, execution}，映射蓝图退回目标。
2. runDesignTeamPipeline 按 owner 路由修订：copy -> copywriter 重出文案后 executor 应用；layout/execution -> executor；asset/insight -> 对应分析角色补充后再执行。无 owner 时默认 executor（当前行为）。
3. 路由表是数据（design-teams 层常量），不是 Agent 运行时分支。

## 5. A9 复盘反哺

1. 流水线与详情页/主图技能完成后，生成 learnings 条目（做对了什么、退回原因、用户修改意见）写入 State.learnings 与 version_history。
2. learnings 在下次任务的 State 摘要中自动可见；后续可选择性沉淀到用户知识库（user-knowledge），本期不做自动写入知识库，避免无依据学习。

## 6. 设计技能补强

### 6.1 详情页（detail-page-design）

链路现状（2026-06-11 已修通）：素材分析 -> 模板解析 -> 问题检测/修复 -> 内容匹配 -> 填充 -> 截图/落位验证 -> 切片导出；smoke 11/12（1 个依赖现场文档）。

| 补强项 | 对应蓝图 | 做法 |
| --- | --- | --- |
| 文案方案消费 | A4 | 匹配/填充计划优先消费 State.copywriting 与 selling_points；缺失时由模型在循环内委派 copywriter 产出，不再依赖技能内固定 copy 流程 |
| 视觉方向消费 | A5 | State.visual_direction 进入填充计划的风格约束（字体/色彩倾向提示给模型，非硬编码） |
| 版本记录 | A0 | 每次填充/导出写 version_history（版本号+修改原因） |
| 屏级重做 | A8 | 评审 issues 定位到 screen 时，仅重填该屏（fillDetailPage 已支持按计划粒度执行） |

### 6.2 主图（main-image-design）

现状：能力已较完整（800/750/1200 交付规划、点击/转化规则、白底图 SKU 源边界、strategy-only 与受控 live 分离）。

| 补强项 | 对应蓝图 | 做法 |
| --- | --- | --- |
| 策略输入消费 | A3/A4 | 主图策划读取 State.selling_points / target_user / visual_direction，卖点上图有据可依 |
| 多版本产出 | A7 | 支持一次产出 2-3 个构图方案（version_history 记录），由用户/critic 选定后精修 |
| 主图评审标准 | A8 | critic 的主图评审要点（主体占比、卖点可读性、点击导向）写入角色提示与知识库，不写入 Agent 运行时 |

## 7. 开发阶段划分

| 阶段 | 内容 | 前置 | 验收 |
| --- | --- | --- | --- |
| DPS-1 | State 契约 + 持久化 + 读写工具 + 黑板写穿 + 主循环摘要注入 | 无 | 专项 smoke 全绿 + tsc/构建 + 纪律套件 |
| DPS-2 | copywriter / market-researcher 角色 + critic reroute + 流水线退回路由 | DPS-1 | design-team smoke 扩展（角色交叉校验、路由用例） |
| DPS-3 | A9 复盘 learnings + version_history 写入 | DPS-1 | 专项 smoke + 实测一轮流水线后检查 State |
| DS-1 | 详情页技能消费 State（文案/视觉方向/版本/屏级重做） | DPS-1、DPS-2 | 详情页 smoke 扩展 + Photoshop 现场实测 |
| DS-2 | 主图技能消费 State + 多版本产出 | DPS-1、DPS-2 | 主图 smoke + Photoshop 现场实测 |

边界：本规划不改 UI 主结构；不引入第二套状态体系（State 与 project-memory 的关系：State 面向单个设计项目，project-memory 面向仓库开发过程，互不替代）。

## 8. 2026-06-12 对齐补充：精修角色、Eagle 接入与可用标准

用户对齐确认的三项补充（均在项目内已有规划痕迹，本节将其转为明确计划）：

### 8.1 精修 Agent（retoucher，新队友角色）——已搁置（2026-06-12 用户决定，设计留档）

> 状态：用户评估实现难度较大，暂不纳入实现。本节设计保留，未来启动时直接使用。

- 背景：project-memory 反复挂账「SKU 色卡精修、审美、光影统一」为主线未完成项，但无角色无实现。
- 定位：执行后的像素级质量提升，与 executor 互补——executor 负责结构性修订（布局/内容），retoucher 负责观感修复（色卡统一、光影统一、边缘清理、协调融合、细节修补）。
- 蓝图映射：A7 执行生产的质量半区 + A8 审核优化的"优化"半区。
- 实现要点：design-teams 新角色（canWriteToPhotoshop: true，串行执行）；工具白名单以 harmonize / IC-Light 重打光 / 色彩调整 / 锐化降噪 / 快照验证为主；critic 退回路由表中 owner='visual' 由 executor 改派 retoucher；流水线在 execute 与 review 之间插入可选 retouch 阶段（默认按需触发，不强制）。
- 验收：角色 smoke 交叉校验扩展 + 真实 SKU 色卡精修案例一轮。

### 8.2 Eagle 创意参考接入（R0 参考源路由的落地）

- 现状盘点：shared/eagle-readonly-knowledge.ts 协议层完整（12 个只读 MCP 工具，含 ai_search_by_text 语义搜索；默认端点 http://127.0.0.1:41596；已内置原始图像字段剥离防 token 膨胀）；主进程 service 与 IPC 已存在；根目录有真实库样本导出（eagle-*.json）。
- 缺口（最后一公里）：Agent 循环工具层没有 Eagle 工具——模型与队友无法调用。
- 实现要点：新增循环工具 searchEagleReferences（封装 item_query/ai_search_by_text）与 getEagleReferenceDetails（item_get/folder_get/tag_get），执行分类 knowledge_search；队友白名单接入 market-researcher / design-strategist / scene-analyst；设置页提供端点配置与连通性测试；结果按 R0 边界标记来源并禁止照抄（提示层约束）。
- 外部前置：用户需在 Eagle（4.0+）偏好设置中启用 MCP Server；官方文档 https://cn.eagle.cool/support/article/eagle-mcp-server 与 https://developer.eagle.cool/plugin-api。
- 验收：Eagle 运行时连通性 smoke（不可用时优雅降级）+ 队友在真实任务中检索参考并标注来源。

### 8.3 「可用」验收标准 v2（含 SKU）

一个真实项目从打开到交付，全程不碰 PS 工具栏：

1. 对话下 brief → 卖点/文案方案（可含 Eagle 参考佐证）→ 用户确认。
2. 主图：800/750/1200 真实生成、可编辑、导出项目主图目录。
3. 详情页：模板填充 → 截图审稿 → 两条修改意见生效 → 切片导出。
4. SKU：配置化批量生成 + 自选备注 + 导出读回（已具备）。（色卡精修随 retoucher 搁置，继续挂账）
5. 跨会话记忆：重开应用能准确回答项目进展（Design Project State）。
6. 全程错误可懂、进度可见、失败可恢复。
