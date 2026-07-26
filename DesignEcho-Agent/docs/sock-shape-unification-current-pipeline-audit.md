# 袜子形态统一当前调用链审计

## 1. 审计目的

这份审计只回答事实问题：

1. 当前“形态统一”到底有哪几条调用链？
2. 哪条是聊天/Agent 链？
3. 哪条是面板/UI 链？
4. 哪些文件是活跃路径，哪些更像旁路或半成品？
5. 当前最关键的结构问题是什么？

## 2. 结论

当前至少存在 **两条平行链路**：

1. **聊天/Agent skill 链**
2. **面板 UI 专用链**

它们没有收口到同一个真实主线。

这就是当前边界混乱和实现不稳定的根因之一。

## 3. 聊天 / Agent skill 链

### 3.1 入口

当前 skill 仍然注册在执行器注册表中：

- [index.ts](C:\DesignEcho\DesignEcho-Agent\src\renderer\services\skill-executors\index.ts)

对应执行器：

- [shape-morphing.executor.ts](C:\DesignEcho\DesignEcho-Agent\src\renderer\services\skill-executors\shape-morphing.executor.ts)

### 3.2 当前状态

这条链此前存在明确参数错位：

- 旧执行器传：
  - `refShapeLayerId`
  - `productLayerIds`
- UXP 工具定义的是：
  - `targetShapeLayerId`
  - `sourceLayerId` / `sourceLayerIds`

相关文件：

- [shape-morphing.executor.ts](C:\DesignEcho\DesignEcho-Agent\src\renderer\services\skill-executors\shape-morphing.executor.ts)
- [tool-classes.ts](C:\DesignEcho\DesignEcho-UXP\src\tools\morphing\tool-classes.ts)

这个问题已经修正：

- 内部执行器现在统一归一化为：
  - `targetShapeLayerId`
  - `sourceLayerId` 或 `sourceLayerIds`
- 单图走 `morphToShape`
- 多图走 `batchMorphToShape`

### 3.3 当前边界

根据已确认的产品边界，这条 skill 不应继续作为用户聊天直接触发的能力。

现在已调整为：

- `visibility: system-only`

相关文件：

- [skill-declarations.ts](C:\DesignEcho\DesignEcho-Agent\src\shared\skills\skill-declarations.ts)

并且已从 Agent system prompt 的常见任务映射中移除：

- [agent-system-prompt.ts](C:\DesignEcho\DesignEcho-Agent\src\renderer\prompts\agent-system-prompt.ts)

### 3.4 对这条链的判断

它现在更适合作为：

- 内部/系统能力
- 未来可重用的 operation wrapper

而不是面向普通用户的 Agent skill。

## 4. 面板 UI 专用链

### 4.1 入口

`DesignEcho-UXP` 中存在一条面板专用“形态统一”路径：

- [index.ts:1205](C:\DesignEcho\DesignEcho-UXP\src\index.ts:1205)

这里会：

- 校验参考形状和产品图层
- 发送 WebSocket 请求：
  - `enhanced-shape-morph`

### 4.2 请求参数

它传的是：

- `referenceShapeId`
- `productLayerIds`
- `step`
- `forceRedetect`
- `useOptimizedMorphing`
- `preAlign`
- `shapeMatch`
- `edgeStrength`
- `contentProtection`
- `smoothness`
- `selectedRegions`
- `sockStyle`
- `cuffType`
- `cuffProtected`

相关文件：

- [index.ts:1248](C:\DesignEcho\DesignEcho-UXP\src\index.ts:1248)

### 4.3 当前状态

`enhanced-shape-morph` 现在已经在 Agent 侧完成明确注册：

- [shape-morphing-handlers.ts](C:\DesignEcho\DesignEcho-Agent\src\main\uxp-handlers\shape-morphing-handlers.ts)
- [index.ts](C:\DesignEcho\DesignEcho-Agent\src\main\uxp-handlers\index.ts)

当前接线方式是：

1. UXP 面板发送 `enhanced-shape-morph`
2. Agent 侧 `registerShapeMorphingUXPHandlers(...)` 接收请求
3. 进入 `ShapeMorphingOrchestrator`
4. 由编排器通过 `wsServer.sendRequest(...)` 回调 UXP 工具：
   - `getLayerBounds`
   - `exportLayerAsBase64`
   - `alignLayer`
   - `getLayerContour`
   - `applyDisplacement`

这意味着：

- 面板链现在已经有**明确主入口**
- 不再是“前端发请求但 Agent 无人接收”的状态

### 4.4 当前限制

这条新接线目前只把**真实已存在的能力**收成了一条主线，并没有夸大实现范围。

当前明确支持：

- `step = align`
- `step = morph`
- `step = all`

当前不支持、且会显式报错：

- `step = analyze`
- `step = contour`

这是刻意收紧，不是假支持。

### 4.5 当前主线内部结构

当前 `enhanced-shape-morph` 主线已经继续收成：

1. `ShapeMorphingAnalyzerService`
2. `ShapeMorphingPlannerService`
3. `ShapeMorphingValidatorService`
4. `ShapeMorphingExecutorService`
5. `ShapeMorphingOrchestrator`

相关文件：

- [analyzer.ts](C:\DesignEcho\DesignEcho-Agent\src\main\services\shape-morphing-pipeline\analyzer.ts)
- [planner.ts](C:\DesignEcho\DesignEcho-Agent\src\main\services\shape-morphing-pipeline\planner.ts)
- [validator.ts](C:\DesignEcho\DesignEcho-Agent\src\main\services\shape-morphing-pipeline\validator.ts)
- [executor.ts](C:\DesignEcho\DesignEcho-Agent\src\main\services\shape-morphing-pipeline\executor.ts)
- [shape-morphing-orchestrator.ts](C:\DesignEcho\DesignEcho-Agent\src\main\services\shape-morphing-orchestrator.ts)

这一步的意义不是“算法已经完成”，而是：

- 分析、规划、验证、写回职责开始真正拆开
- 后续 prototype 可以明确定位问题落点
- 不再继续把所有逻辑堆在一个 orchestrator 文件里

## 5. UXP Morph 工具链

### 5.1 已注册工具

真正挂在 UXP ToolRegistry 里的，是这些工具：

- `extractShapePath`
- `getLayerContour`
- `morphToShape`
- `batchMorphToShape`
- `applyDisplacement`

相关文件：

- [registry.ts](C:\DesignEcho\DesignEcho-UXP\src\tools\registry.ts)
- [tool-classes.ts](C:\DesignEcho\DesignEcho-UXP\src\tools\morphing\tool-classes.ts)

### 5.2 当前执行能力

`morphToShape` 当前真实行为更像：

1. 提取目标形状
2. 提取源轮廓
3. 计算粗对齐
4. 计算形状差异
5. 准备发往 Agent 的请求
6. 尝试应用对齐预览

它没有形成完整“高质量形态统一结果写回”的主线。

相关文件：

- [morph-executor.ts](C:\DesignEcho\DesignEcho-UXP\src\tools\morphing\morph-executor.ts)

### 5.3 已有真实写回能力

`applyDisplacement.ts` 是当前最接近真实变形写回能力的实现：

- `getPixels`
- 稀疏位移场反序列化
- 插值
- `putPixels`

相关文件：

- [apply-displacement.ts](C:\DesignEcho\DesignEcho-UXP\src\tools\morphing\apply-displacement.ts)

这说明：

**真正可延续的主线，更像“Agent/Main 端算位移 + UXP 写回”，而不是单靠 `morphToShape` 现状。**

## 6. Agent/Main 侧相关实现

### 6.1 已存在的更强实现

这些文件里已经有更接近真实算法内核的实现：

- [shape-morphing-orchestrator.ts](C:\DesignEcho\DesignEcho-Agent\src\main\services\shape-morphing-orchestrator.ts)
- [optimized-morphing-service.ts](C:\DesignEcho\DesignEcho-Agent\src\main\services\morphing\optimized-morphing-service.ts)
- [enhanced-morph-executor.ts](C:\DesignEcho\DesignEcho-Agent\src\main\services\morphing\enhanced-morph-executor.ts)
- [sock-morph-engine.ts](C:\DesignEcho\DesignEcho-Agent\src\main\services\sock-morphing\sock-morph-engine.ts)
- [sock-morph-integration.ts](C:\DesignEcho\DesignEcho-Agent\src\main\services\sock-morphing\sock-morph-integration.ts)

### 6.2 当前判断

这些实现已经具备不少中间件能力，但从当前代码引用关系看：

- 它们不像已经被统一收进一个稳定的主调用链
- 更像：
  - 半成品
  - 并行实验链
  - 未完全接线的候选实现

其中：

- `optimized-morphing-service.ts` 已经进入当前主线，用于计算稀疏位移场
- `enhanced-morph-executor.ts`
- `sock-morph-engine.ts`
- `sock-morph-integration.ts`

目前仍更像候选实现，而不是当前面板主线的唯一执行路径

## 7. 当前最关键的结构问题

### 问题 1：聊天链和面板链边界长期混乱

- 聊天链：`shape-morphing` skill
- 面板链：`enhanced-shape-morph`

现在已明确：

- 面板链是当前唯一可信主线
- 聊天链只保留为 `system-only` operation wrapper

### 问题 2：当前对外承诺超前于真实实现

`MorphToShapeTool` 描述中已经写：

- 保持内部图案和花边不变形

但从当前主链看，这个承诺还没有真实落地。

### 问题 3：活链和研究链混在一起

当前仓库同时存在：

- 对外活跃入口
- 研究型实现
- TODO 分支
- 旁路编排器

但没有明确“唯一主线”。

## 8. 当前已做的收正

### 8.1 skill 边界收正

`shape-morphing` 已改为：

- `system-only`

避免继续被 Agent 当普通用户技能使用。

### 8.2 参数契约收正

内部 executor 现在已修为：

- 单图：`morphToShape(targetShapeLayerId, sourceLayerId)`
- 多图：`batchMorphToShape(targetShapeLayerId, sourceLayerIds)`

### 8.3 面板主路径补齐

当前已补齐：

- `enhanced-shape-morph` Agent-side handler
- 通过 `ShapeMorphingOrchestrator` 连接到现有变形编排
- 返回统一结果形状：
  - `success`
  - `results`
  - `totalLayers`
  - `successCount`
  - `error`

## 9. 对 prototype 的直接影响

后续第一阶段 prototype 不应建立在“聊天 skill 链”上。

更合理的顺序是：

1. 先以 **面板 operation** 为目标
2. 继续沿已补齐的 `enhanced-shape-morph` 主线推进
3. 把：
   - analyzer
   - planner
   - validator
   - executor
   收口到一条主线

## 10. 结论

当前“形态统一”的最真实状态不是：

- 没有任何实现

也不是：

- 已经有完整可交付主线

而是：

**存在多组半成品能力，但当前已经把面板 `enhanced-shape-morph` 收成了唯一可信主线；后续工作应继续围绕这条主线收口，而不是再扩平行链。**

后续任何 prototype 和功能开发，都必须以这份事实为前提。

## 11. 新确认的参数真相与本轮修复

### 11.1 UI 存在真实取值错位

之前 WebView 的 `getMorphingConfig()` 读取的是：

- `.sock-style-item.active`

但真实 UI 使用的是：

- `#sockStyleSelect[data-value]`

结果是 `sockStyle` 实际上经常掉回默认值。

这次已修正为直接读取 `#sockStyleSelect` 的 `data-value`。

### 11.2 UI 命名和主链命名之前不一致

之前存在三组明显不一致：

1. `boat` vs `no-show`
2. `double-welt` / `fold` vs `double` / `folded`
3. `foot` vs `body`

这次已经做了统一归一：

- `boat -> no-show`
- `double-welt -> double`
- `fold -> folded`
- `foot -> body`

### 11.3 之前多个参数只是“浅传参”

在本轮修复前：

- `sockStyle` / `cuffType` 主要只参与门禁
- `selectedRegions` 主要只做校验
- `contentProtection` 没有真正落到当前 `optimized-morphing` 主链
- `quality` 没有稳定覆盖主链的质量预设

### 11.4 本轮已收正的地方

当前主链已经新增了这些真实消费：

1. `quality`
- 会显式进入 planner
- 不再总是靠 `edgeStrength + smoothness` 反推出质量档位

2. `selectedRegions`
- 已接入区域轮廓裁剪
- 当前会优先使用 `SockRegionAnalyzer` 的区域轮廓点来生成局部变形轮廓

3. `contentProtection`
- 已重新接入 `OptimizedMorphingService`
- 会基于 `sourceImageBase64` 做图案/花边分析并生成保护权重

4. `cuffProtected`
- 已影响当前 `detectLace / cuff protection` 路径

5. `regionAnalysis`
- 已进入 analyzer / validator / planner
- 当前 prototype 已开始使用：
  - orientation
  - cuffAnalysis
  - region contour slices

### 11.5 当前仍然不能夸大的地方

虽然参数链已经更真实，但这不等于“质量问题已经解决”。

当前更准确的说法是：

- 参数和主链的错位已经明显减少
- prototype 终于开始真正消费一部分 UI 参数
- 但复杂袜口、复杂图案、复杂纹理质量依然没有被证明

## 12. 新确认：区域感知匹配已进入 prototype 主线

本轮已将区域感知控制点匹配正式接入当前 prototype 主线：

1. planner 现在会优先尝试基于：
   - `SockRegionAnalyzer`
   - `RegionAwareMatcher`
   构建控制点对

2. 当区域分析可用且匹配质量达到最低门槛时：
   - 当前主线将不再只依赖轮廓重采样
   - 而是使用 `region-aware` 控制点对驱动 MLS

3. 当区域分析不可用或匹配质量不足时：
   - 才会回退到 `contour` 匹配

4. 当前成功结果的 `method` 已明确区分：
   - `optimized-morphing:<quality>:region-aware`
   - `optimized-morphing:<quality>:contour`

这意味着现在可以明确验证：

- 本次是否真的使用了区域感知匹配
- 还是已经回退到轮廓匹配

这一步的意义不是“质量已经足够”，而是：

**主线终于开始具备真正能影响质量的结构，而不是只停留在参数和门禁层。**

## 13. 新确认：骨架轴线已进入对齐与匹配主线

本轮继续把 `skeleton-alignment` 的最小可复用能力接进了当前 prototype 主线，但仍保持在安全范围内：

1. 对齐步骤不再只依赖：
   - 参考高度
   - 主体中心
   - 图层中心

2. 当前 `planner` 会在条件满足时额外使用：
   - `extractSkeleton(...)`
   - `alignSkeletons(...)`

3. 这层骨架信号现在有两个真实用途：
   - 在 **align** 阶段生成 `skeleton-axis` 的缩放与中心对齐决策
   - 在 **morph** 阶段作为额外 `skeleton anchors` 并入 `region-aware` 控制点对

4. 当前成功方法已能明确区分：
   - `skeleton-axis`
   - `optimized-morphing:<quality>:region-aware+skeleton`
   - `optimized-morphing:<quality>:contour`

这一步的意义不是“复杂袜子质量已解决”，而是：

**主线现在已经从“仅靠 bbox/中心点”推进到“开始使用中轴线结构信号”。**

当前仍然成立的边界：

1. 这不是完整骨架驱动变形系统
2. `coordinate-transform` 仍未进入当前 prototype 主线
3. 复杂花边、木耳边、复杂图案质量依然没有被证明
