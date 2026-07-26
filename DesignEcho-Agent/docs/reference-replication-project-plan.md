# 参考图复刻项目规划与实现

## 1. 文档目的

本文件用于收口当前项目在“参考图理解并复刻设计”方向上的真实现状、目标能力、实施路线、阶段验收与架构调整。

本文档遵循以下原则：

1. 只把已核实内容写成现状
2. 规划与事实分开写
3. 不把长期愿景提前描述为已具备能力

## 2. 当前真实现状

### 2.1 已核实（代码）

当前项目已经具备以下基础：

1. 已存在独立的 `layout-replication` skill 与路由信号
   相关文件：
   - `src/shared/skills/skill-declarations.ts`

2. 已存在参考图复刻执行器
   相关文件：
   - `src/renderer/services/skill-executors/layout-replication.executor.ts`

3. 当前执行器具备以下基本能力：
   - 接收附图输入
   - 选择视觉模型
   - 生成参考图分析 prompt
   - 解析分析结果
   - 生成可编辑骨架
   - 调用有限 Photoshop 工具执行

4. 项目已接入 Xiaomi MiMo provider，当前保留 `xiaomi-mimo-v2.5-pro` 与 `xiaomi-mimo-v2.5` 模型配置
   相关文件：
   - `src/shared/config/models.config.ts`
   - `src/main/services/model-service.ts`
   - `src/main/services/stream-adapter.ts`
   - `src/renderer/components/SettingsModal.tsx`

5. 图片输入链路已能把附图带入 Agent 上下文
   相关文件：
   - `src/renderer/components/ChatPanel.tsx`
   - `src/renderer/services/design-agent/engine.ts`

### 2.2 已核实（构建）

1. 在 Xiaomi MiMo 接入后，`npm run build` 已通过

### 2.3 已核实（手测）

1. 用户已确认 Xiaomi 模型可在应用内使用

### 2.4 未核实 / 待验证

当前仍没有证据证明以下事项已经成立：

1. 参考图复刻在真实设计任务中的稳定性
2. 参考图复刻已经达到高保真可编辑设计
3. 当前能力可泛化到海报、详情页、营销图等多种参考图
4. 已存在完整视觉 QA 与自动微调闭环

## 3. 项目目标

## 3.1 当前阶段目标

当前阶段目标不是“实现全设计能力”，而是：

1. 用户提供一张参考图
2. Agent 形成结构化设计理解
3. 系统生成可执行设计表示
4. Photoshop 中产出可编辑结果
5. 结果可被复核和评估

## 3.2 长期目标

在参考图复刻能力稳定后，逐步扩展到：

1. 电商设计
2. 平面设计
3. 品牌设计中的部分结构化任务
4. 设计知识系统
5. 视觉 QA 与持续改进闭环

## 3.3 当前非目标

以下内容不应在当前阶段作为主目标推进：

1. 全场景品牌设计自动化
2. 任意艺术风格海报的高保真还原
3. 重型知识图谱建设
4. 不受约束的多 Agent 扩张

## 4. 项目问题定义

当前真正的问题不是“模型没有知识”，而是以下链路没有收口：

1. 参考图理解结果没有统一中间表示
2. `layout-replication.executor` 职责过重，分析与执行混合
3. 图片放置、缩放、锚点与裁切策略尚未独立建模
4. 缺少 recipe 化的样式执行系统
5. 缺少 benchmark 与评估标准
6. 讨论中的目标容易提前被描述为能力事实

## 5. 能力分解

“参考图理解并复刻设计”应拆成以下能力层：

### 5.1 Reference Parse

负责从参考图中提取候选结构：

1. 画布尺寸
2. 构图类型
3. 元素列表
4. 元素关系
5. 视觉层级

当前状态：

- 已有雏形
- 仍与 executor 混合

### 5.2 Minimal Design Representation

负责把解析结果收敛成最小可执行表示。

目标字段至少包括：

1. 画布信息
2. 元素角色
3. 元素边界框
4. 层级
5. 基本对齐/锚点关系
6. 图片放置策略引用
7. 样式引用

当前状态：

- 尚未独立成明确真相源

### 5.3 Layout / Placement Policy

负责解决：

1. 放哪
2. 放多大
3. 相对谁对齐
4. 图片如何缩放
5. 是否需要裁切
6. 主体如何保护

当前状态：

- 尚未形成独立策略层

### 5.4 Visual Recipe

负责可复用视觉做法，而不是每次让模型临场生成：

1. 标题样式
2. CTA 样式
3. 卡片样式
4. 背景样式
5. 常见营销组件

当前状态：

- 尚未形成首批稳定 recipe 集

### 5.5 Photoshop Execution

负责把已确定的设计表示和执行计划落到 Photoshop。

原则：

1. 只做确定性执行
2. 不在执行器内部承担过多推理

当前状态：

- 已有基础工具调用能力
- 但复刻执行器仍混入推理逻辑

### 5.6 QA / Review

负责判断结果是否接近参考图，并支持下一轮修正。

当前状态：

- 尚未形成闭环

## 6. 目标架构

建议逐步收敛成以下链路：

`用户参考图 -> Intent Router -> Reference Parser -> Minimal Design Representation -> Layout / Placement Policy -> Recipe Planner -> Photoshop Executor -> QA / Review`

当前不建议直接扩成重型知识图谱架构。先把这条主链做实。

## 7. 分阶段实施路线

## 7.1 M0：项目记忆真相源收口

目标：

1. 项目推进不依赖聊天上下文
2. 项目状态、风险、待办、决策外部化

主要产出：

1. `project-memory` 体系
2. 机器可读状态文件
3. 清晰的回顾顺序与更新规则

状态：

- 进行中

## 7.2 M1：参考图复刻最小闭环

目标：

1. 从参考图得到最小可执行设计表示
2. 生成可编辑骨架
3. 不再让 executor 兼任全部推理职责

实施项：

1. 梳理当前 `layout-replication.executor` 的职责边界
2. 抽出最小中间表示定义
3. 抽出 Reference Parse 与 Representation 归一化
4. 让 executor 只消费已归一化结果
5. 建立首批 benchmark case

验收：

1. 执行器职责明显收窄
2. 有最小中间表示定义
3. 有最小可重复验证样例

## 7.3 M2：图片放置与缩放策略

目标：

1. 参考图中的图片区域能映射成目标槽位
2. 图片位置、大小、裁切和主体保护可解释

实施项：

1. 定义 placement policy
2. 定义图片槽位结构
3. 明确缩放模式和裁切模式
4. 明确锚点规则

验收：

1. 图片落位不是凭模型临场猜
2. 可解释“为什么是这个位置和尺寸”

## 7.4 M3：首批 recipe

目标：

1. 建立高频视觉样式的稳定执行方式
2. 降低“临场发挥”导致的不稳定

实施项：

1. 收集高频组件
2. 对每个 recipe 做可执行性审计
3. 定义最小 recipe 结构
4. 接入执行器

验收：

1. 首批高频 recipe 可用
2. 每个 recipe 有适用边界与失败条件

## 7.5 M4：QA 与评分

目标：

1. 结果不再靠主观感觉判断
2. 形成复刻质量的评估标准

实施项：

1. 建 benchmark case
2. 建评分表
3. 定义结构相似度、图片落位、文本层级等指标
4. 建立手工复核流程

验收：

1. 每轮改造都有可比较结果
2. 项目不再陷入“感觉更好了”的模糊推进

## 7.6 M5：轻量知识系统

目标：

1. 为设计复刻与后续设计任务提供可检索知识
2. 但不提前引入重型图谱

实施项：

1. 先做结构化设计库
2. 再做轻量检索
3. 最后视规模判断是否需要关系层升级

验收：

1. 知识系统服务执行链，而不是替代执行链
2. 不把知识层当作当前主问题的替代答案

## 8. 架构调整建议

### 8.1 当前需要新增或收敛的模块

建议新增或明确以下模块：

1. `reference-parse-result`
2. `minimal-design-representation`
3. `placement-policy`
4. `recipe-registry`
5. `benchmark / qa`

### 8.2 当前最需要收口的文件

1. `src/renderer/services/skill-executors/layout-replication.executor.ts`
2. `src/shared/prompts/reference-analysis.ts`
3. `src/shared/skills/skill-declarations.ts`
4. `src/shared/model-selection.ts`
5. `src/shared/config/tool-dependencies.ts`

## 9. 知识系统规划

当前结论：

1. 项目最终需要知识系统
2. 但当前不应直接启动重型知识图谱
3. 应先完成最小复刻闭环

建议顺序：

1. 结构化设计库
2. 轻量 RAG
3. 视规模决定是否引入关系层 / 图谱层

知识层必须服务以下主链：

1. Reference Parse
2. Representation
3. Placement
4. Recipe 选择
5. QA 判定

## 10. 评估与验收机制

项目后续必须建立三类评估：

### 10.1 代码与构建评估

1. 代码结构是否更清晰
2. 构建是否通过
3. 是否引入新的职责混乱

### 10.2 功能评估

1. 能否生成可编辑骨架
2. 是否能正确使用附图
3. 是否能在无文档时继续建立复刻文档

### 10.3 设计评估

1. 结构是否接近参考图
2. 图片落位是否合理
3. 文本层级是否接近
4. 最终结果是否具备继续编辑价值

## 11. 当前最合理的下一步

当前建议的直接下一步不是继续扩系统，而是：

1. 定义最小中间表示
2. 切分 `layout-replication.executor` 职责
3. 建立首批 benchmark case

只有这三件事完成后，后续知识系统、recipe、QA、设计扩展才会更稳。

## 12. 结论

当前项目已经有“参考图复刻基础雏形”，但仍处于从“分析 + 骨架生成”走向“稳定设计复刻系统”的过渡阶段。

本项目规划的核心不是盲目扩功能，而是按以下顺序收口：

1. 记忆真相源
2. 最小复刻闭环
3. 放置与缩放策略
4. 首批 recipe
5. QA 与 benchmark
6. 轻量知识系统

这个顺序比“先堆大架构再补效果”更符合当前项目阶段，也更能降低信息失真、能力夸大和开发偏航的风险。
