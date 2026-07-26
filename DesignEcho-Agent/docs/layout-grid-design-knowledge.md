# 网格排版设计知识与 Agent 落地规划

更新时间：2026-04-30

## 结论

网格排版适合作为 DesignEcho Agent 的排版底座之一。它能把“凭感觉放大/移动/对齐”转成可计算的约束：画布安全区、列、行、沟槽、边距、基线、间距 token、元素跨度和吸附规则。这样可以减少模型每次重新猜位置，也能让 Photoshop 执行结果更稳定。

但网格不能被硬编码成单一 12 栏。电商主图、详情页、合格证文字排版、SKU 图和品牌海报的网格密度不同。正确方式是：先从参考图或任务类型推断网格，再让元素落到网格上，同时允许主视觉/艺术化元素有受控破格。

## 外部知识来源

### Figma Layout Guides

Figma 将 layout grids 更名为 layout guides。官方定义是：给 frame 添加的视觉辅助，用于精确对齐、建立结构，并让设计在多平台上保持逻辑和一致性。Figma 支持三类 guide：uniform grid、columns、rows。Columns/rows 具备 count、width/height、offset、margin、gutter 等属性。

对项目的启发：
- Photoshop Agent 也需要类似 guide 的内部表示，不一定先画出参考线，但执行器需要知道元素应该贴哪条线。
- uniform grid 可用于图标、细小元素、按钮、局部模块。
- columns/rows 更适合详情页、合格证、海报和 SKU 模板结构。

来源：https://help.figma.com/hc/en-us/articles/360040450513-Create-layout-grids-with-grids-columns-and-rows

### Material Design Responsive Grid

Material 的响应式 UI 基于 12-column grid，但关键不是固定列宽，而是保持 margin 和 gutter 的一致。Material 还强调 margin/gutter 可使用 8、16、24、40dp 等基于 8dp baseline 的值，并且 margin 与 gutter 不必相等。

对项目的启发：
- 对详情页/海报，不应该只输出绝对 x/y；应该输出 margin、gutter、column span。
- 8px/8dp 基线适合作为通用吸附单位，但电商图片可根据画布尺寸缩放为 8/10/12/16px token。
- “一致的沟槽和边距”比“所有元素等宽”更重要。

来源：https://m1.material.io/layout/responsive-ui.html

### IBM 2x Grid

IBM 2x Grid 将网格视为所有视觉元素和 typography 的框架。它强调以 2 的分割建立结构，例如 2、4、8、16、32、64 列；列/行应等宽；有 gutter 时，文字应对齐 gutter，而不是直接对齐画布切分线。

对项目的启发：
- 设计 Agent 可用 2/4/8/16 这样的候选网格推断参考图结构。
- 对电商长图，4/8 栏常比 12 栏更实用；对文字密集图，行网格和基线比列数更关键。
- gutter 对齐规则能解释很多“看起来整齐”的设计，而不是只靠元素左边界聚类。

来源：https://www.ibm.com/design/language/2x-grid

### Atlassian Grid 与 Spacing

Atlassian 将 grid anatomy 拆为 columns、gutters、margins，并区分 fixed/fluid grid。其 spacing system 使用 8px base unit，有限的 spacing scale 用来维持一致性和未来响应式/密度变化能力。

对项目的启发：
- 项目需要 spacing token，不应让模型自由发明间距。
- 可以用有限 token 做排版判断：4/8/12/16/24/32/48/64/80。
- 对 Agent 来说，spacing token 是比“更高级一点”“间距舒服一点”更可执行的语言。

来源：
- https://atlassian.design/foundations/grid-beta/
- https://atlassian.design/foundations/spacing

## 对 DesignEcho 的可落地定义

### 1. Design Grid DSL

建议增加一个内部 Grid DSL，不直接依赖模型自由描述。

```ts
interface DesignGridSpec {
  canvas: { width: number; height: number };
  liveArea: { x: number; y: number; width: number; height: number };
  columns: { count: number; gutter: number; marginLeft: number; marginRight: number; width: number };
  rows?: { baseline: number; rowStep?: number; gutter?: number };
  spacingScale: number[];
  confidence: number;
  source: 'task-preset' | 'reference-inferred' | 'template-detected' | 'user-provided';
}
```

### 2. 元素从绝对坐标升级为网格约束

当前参考图复刻已经有 `textLayout.rowId / columnId / textAlign / rowStep`，这是正确方向，但还缺少：
- liveArea：内容区域，不等于整个画布。
- column span：元素占几栏。
- gutter：列与列之间的固定间距。
- baseline：文字基线/行距节奏。
- snap tolerance：吸附容差。
- break-out：允许主视觉突破网格，但需要标记原因。

建议元素执行前增加：

```ts
interface GridPlacementConstraint {
  elementId: string;
  anchorColumn?: number;
  columnSpan?: number;
  anchorRow?: number;
  baselineStep?: number;
  snapTolerancePx: number;
  allowBreakout?: boolean;
  reason?: string;
}
```

### 3. 网格推断策略

从参考图或当前文档中推断网格时不要只靠模型。应采用混合方法：
- 先用视觉模型/DSL 提供元素框。
- 再用确定性算法聚类 left/right/center/baseline。
- 在候选网格中评分：4、6、8、12、16 栏，margin/gutter 取 spacing token。
- 以最小误差解释最多元素的网格为主网格。
- 对无法解释的元素标记 `freeform` 或 `breakout`，不要强行吸附。

评分建议：
- 70% 元素能贴近列线/行线。
- 文字行距 variation 小。
- margin/gutter 落在 token scale。
- 主视觉重心符合任务类型安全区。

### 4. Photoshop 执行策略

网格不是最终图层，而是执行约束：
- 新建文档后先生成内部 grid spec。
- 可选地在 Photoshop 添加 guide 作为调试层/验收工具。
- 创建文字/图片/形状前，先把目标 box snap 到 grid。
- 创建后读取实际 bounds，比较实际 bounds 与 grid constraint。
- QA 报告中输出：gridFitScore、offGridElements、baselineDeviation、marginDeviation。

### 5. 适合先落地的业务场景

优先级：
1. 合格证/吊牌/纯文字信息图：行列结构强，网格收益最大。
2. SKU 模板：组合图、色块、文字标签高度依赖重复网格。
3. 详情页模块：每屏可有不同局部网格，适合做模块级 grid。
4. 主图：网格只能作为安全区和重心约束，不能限制创意构图。
5. 高艺术海报：只能做辅助，不应强制全局网格。

## 当前项目差距

已具备：
- `reference-replication-layout-structure.ts` 已能识别文本节点、行组、列组、行距 rhythm。
- `reference-replication-blueprint.ts` 已把 row/column/textAlign 透传到 blueprint。
- `layout-replication-apply.ts` 已在创建文字层时消费 textAlign。

缺口：
- 没有 `DesignGridSpec` 真相源。
- 没有 liveArea / margin / gutter / column span。
- 没有候选网格评分。
- 没有 Photoshop guide 调试/验收入口。
- 没有 gridFitScore 进入 QA。
- 没有任务类型预设：主图、详情页、SKU、合格证应使用不同网格策略。

## 建议实施顺序

### M1：知识和 DSL 收口

新增 `reference-replication-grid.ts`：
- 定义 `DesignGridSpec`、`GridPlacementConstraint`。
- 提供默认 spacing scale。
- 提供常用 task preset：poster/detail/main-image/sku/text-certificate。

### M2：参考图网格推断 MVP

在 `reference-replication-layout-structure.ts` 后面增加 grid inference：
- 根据文本和图形元素推断 liveArea。
- 尝试 4/6/8/12 栏。
- 输出 gridFitScore 和未解释元素。

### M3：执行器消费网格

在 `reference-replication-blueprint.ts` 中把元素 box 转成 grid constraint。
在 `layout-replication-apply.ts` 中创建前 snap，创建后验证。

### M4：Photoshop 验收工具

新增可选工具：
- `createGridGuides`
- `inspectGridFit`
- `removeDebugGuides`

这些是调试/验收工具，不应作为普通用户默认输出。

### M5：业务扩展

把 SKU、详情页、主图逐步接入自己的网格预设：
- SKU：重复单元格网格。
- 详情页：模块级 4/8 栏 + 垂直节奏。
- 主图：安全区 + 重心 + CTA/卖点局部网格。

## 风险与边界

- 不能把所有设计强制吸附到同一网格，否则会破坏创意构图。
- 参考图可能本身不是严格网格，系统需要输出低置信度而不是假装识别成功。
- 网格只能提高结构稳定性，不直接解决字体审美、图片主体裁切、光影合成和风格创意。
- 对 Photoshop 来说，真实执行还必须读回 bounds；不能只相信计算目标框。
