# 设计能力复盘与重构方向

## 目标

把当前项目从“堆业务功能”推进到“具备设计理解能力的 Design Agent”。

核心不是继续加详情页、主图、SKU 的硬编码分支，而是先建立：

1. Photoshop 设计元素感知
2. 元素关系理解
3. 模块与屏的视觉推理
4. 基于参考图的设计动作规划
5. Skills 驱动的设计策略

## 当前问题

当前项目已经实现了不少功能，但核心问题不是功能少，而是基础认知不够准。

现状更像：

1. 模型知道用户想做什么
2. 执行器知道要调用哪些工具
3. 但系统并不真正理解当前 PSD 里每个元素是什么、在哪、和谁有关系

这会带来几个结果：

1. 业务功能越来越多
2. executor 里硬编码越来越重
3. 模型缺少准确上下文，只能猜
4. 最终表现为“不够聪明”“有误差”“细节不稳定”

## 当前已经有的基础

### 1. Photoshop 文档像素读取

当前项目已经可以稳定从文档读取像素，不依赖当前视口位置。

相关：

- `C:\DesignEcho\DesignEcho-UXP\src\tools\canvas\visual-analysis.ts`
- `C:\DesignEcho\DesignEcho-UXP\src\tools\canvas\screen-snapshot.ts`

意义：

- 不受用户滚动画布影响
- 可以做稳定的文档级视觉分析

### 2. 图层几何和层级信息

当前已经能拿到：

- bounds
- parent/path ids
- clipping 关系
- z-order
- flat layer list

相关：

- `C:\DesignEcho\DesignEcho-UXP\src\tools\layout\get-layer-hierarchy.ts`

意义：

- 已具备做元素关系建模的底层条件

### 3. 详情页 screen plan 和视觉分割雏形

当前已经有：

- `detail-page-screen-plan.ts`
- `detail-page-visual-segmentation.ts`
- `detail-page-copy-layout-audit.ts`
- `detail-page-live-placement.ts`

相关：

- `C:\DesignEcho\DesignEcho-Agent\src\shared\detail-page-screen-plan.ts`
- `C:\DesignEcho\DesignEcho-Agent\src\shared\detail-page-visual-segmentation.ts`
- `C:\DesignEcho\DesignEcho-Agent\src\shared\detail-page-copy-layout-audit.ts`
- `C:\DesignEcho\DesignEcho-Agent\src\shared\detail-page-live-placement.ts`

意义：

- 已经有“设计理解内核”的雏形
- 只是还没被抽象成统一内核

### 4. MCP 调试面已经铺开

当前已经有：

- runtime / recent trace
- detail template graph
- detail screen plan
- detail live placements
- detail copy layout audit
- detail visual modules / boundaries / merge

意义：

- 已经具备继续把“设计理解”做成可调试系统的条件

## 当前缺口

### 1. 没有统一的设计元素模型

现在不同功能都在各自理解：

- 文本层是什么
- 图片层是什么
- 这个元素属于哪个模块

但没有一个统一 schema 把这些收拢。

### 2. 没有统一的关系模型

系统还没有稳定表达：

- 元素之间的对齐关系
- 间距关系
- 附着关系
- 主次关系
- 模块归属

### 3. 没有真正的参考图 -> 动作规划层

现在参考图更多还是作为输入素材或视觉方向提示。

真正缺的是：

- 参考图里有哪些设计元素
- 这些元素在当前 PSD 里如何映射
- 哪些可以复用，哪些需要新建
- 应该执行哪些 Photoshop 动作

### 4. 业务逻辑过多地写死在 executor

当前 detail-page / main-image / sku 等执行器里，有大量属于“设计策略”的逻辑。

这类逻辑应该更多放进 skills，而不是继续堆在 executor 中。

## 推荐的能力分层

### Core：设计理解内核

这层应该稳定、通用、可复用，不属于任何单一业务场景。

应包含：

1. 元素感知
   - 图层类型
   - bounds
   - clipping
   - parent/child
   - z-order
   - 颜色/字体/形状特征

2. 关系建模
   - 对齐
   - 间距
   - 重叠
   - 附着
   - 主次
   - 模块归属

3. 视觉分块
   - visual module
   - refined screen boundary
   - structure vs visual merge

4. 执行与审计
   - placement audit
   - copy layout audit
   - live placement reconstruction
   - before / after / overlay truth

### Skills：设计策略层

这层负责“怎么设计”，不负责底层感知。

应包含：

1. 详情页设计 skill
   - 每屏讲什么
   - 图怎么选
   - 文案怎么写
   - 风险怎么修

2. 主图设计 skill
   - 主视觉怎么组织
   - 文案重心怎么放
   - 元素层级怎么安排

3. SKU 设计 skill
   - 组合关系
   - 文案备注策略
   - 变体稳定性

4. 参考图设计迁移 skill
   - 从参考图提取结构
   - 映射到当前 PSD
   - 规划新建/复用/替换动作

### Orchestration：调度层

这层负责：

1. 当前任务属于哪个设计 skill
2. 需要调用哪些 core 能力
3. 什么时候规划、什么时候执行、什么时候审计
4. 如何输出用户可理解的过程和结果

## 对详情页能力的结论

详情页不是单独的一套特殊系统。

它应该建立在统一设计理解内核上：

1. 先理解元素和模块
2. 再识别每屏职责
3. 再按 skill 策略生成内容和动作计划
4. 再执行和复核

也就是说：

- 详情页只是 design skill 的一个场景
- 不是继续单独堆硬编码的中心

## 最值得优先补的核心能力

### 1. 选中元素上下文

当用户点击一个元素时，系统应能稳定拿到：

- 它的 layerId / name / type
- 它的 bounds / center / size
- 它所在父组和路径
- 它与周围元素的关系
- 它所在模块
- 它所在屏

这是所有“智能设计”的起点。

### 2. 统一元素模型

建议第一版至少有：

- `elementId`
- `layerId`
- `kind`
- `bounds`
- `styleHints`
- `parentIds`
- `clippingInfo`
- `moduleId`
- `screenId`
- `semanticRole`
- `confidence`

### 3. 统一关系模型

建议至少有：

- `alignedWith`
- `spacedFrom`
- `containedBy`
- `attachedTo`
- `dominates`
- `belongsToModule`

### 4. 参考图动作规划

不是直接执行，而是先输出结构化计划：

- 识别参考图中的标题、图片区、装饰元素、标签、底块
- 映射到当前 PSD 的元素或空位
- 规划：复用 / 新建 / 替换 / 调整

## 推荐的第一批 MCP 能力

### 1. 元素感知类

- `design.inspect_selected_element`
- `design.inspect_neighbor_elements`
- `design.inspect_element_relations`
- `design.inspect_current_module`

### 2. 视觉结构类

- `detail.inspect_visual_modules`
- `detail.inspect_screen_boundaries`
- `detail.audit_segmentation_merge`
- `detail.capture_visual_context_bundle`

### 3. 参考规划类

- `design.plan_from_reference`
- `design.compare_reference_to_canvas`
- `design.propose_element_actions`

## 下一阶段的最小可验证里程碑

### Milestone 1

建立“选中元素上下文”能力。

目标：

- 用户点击任意元素
- 系统能准确返回它的元素信息、位置、模块和邻近关系

### Milestone 2

建立统一元素模型和关系模型。

目标：

- 不同业务流使用同一套元素/关系 schema
- 不再各自重复解释 PSD

### Milestone 3

把详情页设计 skill 改成真正依赖 core。

目标：

- 详情页逻辑不再把感知、推理、执行全部写死在 executor
- skill 只负责设计策略

### Milestone 4

加入参考图 -> 动作规划。

目标：

- 不是让模型“看图自由发挥”
- 而是先产出动作计划，再执行

## 直接结论

后续不应该继续把系统做成：

- 详情页功能
- 主图功能
- SKU 功能

三堆越来越重的业务硬编码。

更合理的方向是：

1. 先做 Photoshop 设计理解内核
2. 再把详情页、主图、SKU 做成建立在内核之上的 design skills
3. 最后由 agent orchestration 负责调度和解释

这样系统才会真的越来越聪明，而不是越来越重。
