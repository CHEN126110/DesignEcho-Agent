# 袜子形态统一可行性研究

## 1. 这份研究要回答什么

这份研究不是要直接承诺“功能可交付”，而是要回答三个更基础的问题：

1. 这个能力在什么范围内是现实的？
2. 为了把它做出来，必须先解决哪些具体技术问题？
3. 什么情况下应该继续投入，什么情况下应该收缩目标或停止？

## 2. 当前置信度

### 高自动化、强泛化版本

目标：

- 自动处理各种袜型
- 自动保护各种袜口异形
- 图案基本不变形
- 结果直接可用

当前置信度：**低**

原因：

- 复杂袜口保护不是普通分割问题
- 图案/文字/Logo 不变形不是普通 warp 问题
- 针织纹理“自然工整”缺少稳定的自动评价函数
- Photoshop 最终写回还会引入额外失真

### 半自动、受约束版本

目标：

- 支持简单样本
- 有参考形状
- 支持质量验证
- 高风险样本直接拒绝执行

当前置信度：**中等**

这是值得推进验证的版本。

## 3. 已确认的当前代码问题

### 3.1 对外工具能力描述已经超前于真实执行链

`MorphToShapeTool` 的描述写的是：

- “将图层变形为目标形状，保持内部图案和花边不变形”

但从当前代码看，这个承诺还没有被完整实现。

相关文件：

- [tool-classes.ts](C:\DesignEcho\DesignEcho-UXP\src\tools\morphing\tool-classes.ts)
- [morph-executor.ts](C:\DesignEcho\DesignEcho-UXP\src\tools\morphing\morph-executor.ts)
- [sock-morph-integration.ts](C:\DesignEcho\DesignEcho-Agent\src\main\services\sock-morphing\sock-morph-integration.ts)

### 3.2 当前链路很可能没有正确跑通

`shapeMorphingExecutor` 传给 `morphToShape` 的参数是：

- `refShapeLayerId`
- `productLayerIds`

但 `MorphToShapeTool` 实际定义的是：

- `targetShapeLayerId`
- `sourceLayerId`

相关文件：

- [shape-morphing.executor.ts](C:\DesignEcho\DesignEcho-Agent\src\renderer\services\skill-executors\shape-morphing.executor.ts)
- [tool-classes.ts](C:\DesignEcho\DesignEcho-UXP\src\tools\morphing\tool-classes.ts)

这说明当前“形态统一”不只是算法没收口，连参数契约都存在明显不一致。

### 3.3 当前轮廓失败回退过弱

`contour-detector.ts` 在失败时会退到近似边界框轮廓，这对：

- 袜口保护
- 图案保护
- 自然形态统一

都不够。

相关文件：

- [contour-detector.ts](C:\DesignEcho\DesignEcho-UXP\src\tools\morphing\contour-detector.ts)

## 4. 研究问题

这项能力要继续推进，必须先回答下面这些研究问题。

### 4.1 轮廓能不能稳定拿到

问题：

- 在真实拍摄袜子图中，mask/contour 是否稳定？
- 背景、阴影、透视、半透明花边会不会导致轮廓不可信？

如果轮廓本身不稳，后面对应点和 warp 都没意义。

### 4.2 袜口保护能不能稳定成立

问题：

- 平口、卷边、花边、木耳边，是否能被识别为需要保护的区域？
- 保护后还能不能把袜身统一到目标形态？

这是整个能力的核心难点之一。

### 4.3 图案保护是否可以做到“够用”

问题：

- 条纹、文字、Logo、提花，局部应变限制后是否足够自然？
- 如果差异太大，系统是否能够提前拒绝，而不是做坏？

### 4.4 变形路径到底该做成什么

问题：

- 是“全局粗对齐 + 边缘带变形”就够？
- 还是必须上“全场分区非刚性 warp”？
- 在 Photoshop 写回阶段，什么路径副作用最小？

## 5. 样本集怎么设计

研究不能靠几张顺手样本。

### MVP 研究样本

建议先做 **120 张**。

分布建议：

- 背景
  - 纯白：40%
  - 浅色棚拍：30%
  - 有干扰背景：30%

- 姿态
  - 平铺：40%
  - 穿着直立：40%
  - 弯折/倾斜：20%

- 图案复杂度
  - 纯色：30%
  - 轻纹理：40%
  - 明显图案/Logo：30%

- 袜口类型
  - 平口：50%
  - 罗纹/卷边：30%
  - logo/刺绣/轻装饰：20%

### 样本不应进入第一版研究的类别

- 多只重叠
- 严重遮挡
- 高复杂花边/镂空袜口
- 大面积复杂提花/文字
- 明显透视变形

## 6. 通过/失败标准

这一步很重要。没有通过/失败标准，就会无限制“继续修”。

### 通过标准

1. **形状统一**
- 至少 90% 样本的 silhouette IoU >= 0.90

2. **袜口保护**
- 至少 95% 样本袜口边界未出现明显畸变

3. **图案保护**
- 至少 85% 样本在 200% 缩放下没有明显剪切/拉坏

4. **人工修正时间**
- 单张图人工补救中位时间 <= 20 秒

### 失败标准

出现下面任一情况，就不该继续扩大目标：

- catastrophic failure > 10%
- 袜口保护不稳定
- 图案类样本大面积失败
- contour confidence 经常不足，导致大量拒绝执行

## 7. 算法候选方案及风险排序

### 方案 A：全局对齐 + 边缘带 MLS 变形 + 袜口冻结

风险：**低**

优点：

- 工程上最容易先跑通
- 中间区域纹理保留较好
- 更适合作为研究第一阶段

缺点：

- 对大幅度形变能力有限
- 对复杂局部结构适应性一般

### 方案 B：分区 ARAP 网格变形

风险：**中**

优点：

- 更适合局部低失真保护
- 理论上更利于图案保形

缺点：

- 依赖更好的网格和约束点
- 工程复杂度高

### 方案 C：全局 TPS 主变形

风险：**中高**

优点：

- 轮廓匹配容易做

缺点：

- 图案和袜口更容易被全局拉坏
- 不适合作为最终主路径

### 方案 D：CPD + 稠密位移场

风险：**高**

优点：

- 对轮廓对应有理论优势

缺点：

- 对噪声敏感
- 工程调参成本高
- 不适合作为第一阶段

## 8. 最推荐的研究路径

### Phase 0：真相审计

目标：

- 审清当前 UI 到执行器的真实调用链
- 明确哪些文件是真正活跃路径
- 清除参数契约不一致

不做这一步，后面任何算法研究都可能跑在假链路上。

### Phase 1：简单样本可行性验证

目标：

- 只做：
  - 单只袜子
  - 简单袜口
  - 低复杂图案

方法：

- 全局对齐
- 边缘带 MLS 变形
- cuff freeze
- 质量验证

### Phase 2：袜口保护专项

目标：

- 单独验证：
  - 平口
  - 卷边
  - 简单木耳边

输出：

- 哪些能保护
- 哪些要拒绝

### Phase 3：图案保护专项

目标：

- 单独验证：
  - 条纹
  - logo
  - 简单文字

输出：

- 可接受的变形阈值
- 哪些类型先不支持

## 9. 研发分工建议

### Workstream A：链路审计

内容：

- 当前 UI 入口
- executor
- UXP tool
- main service
- Photoshop 写回

输出：

- 真正活跃路径图
- 死代码/TODO 分支清单

### Workstream B：输入质量

内容：

- mask
- contour
- cuff 区域候选
- pattern 区域候选

输出：

- 稳定输入规范

### Workstream C：warp planner

内容：

- 粗对齐
- 边缘带 warp
- 保护区约束

输出：

- `SockWarpPlan`

### Workstream D：validator

内容：

- silhouette match
- cuff distortion
- pattern strain
- local shear

输出：

- `SockMorphValidation`

## 10. 研究交付物

如果这项研究认真做，至少要交付：

1. `current-pipeline-audit.md`
2. `sample-dataset-spec.md`
3. `sock-warp-plan-spec.md`
4. `sock-morph-validation-spec.md`
5. 一组原型测试结果

## 11. 产品边界结论

这项能力当前更适合定义成：

- **修图 operation**
- **内部工具链**
- **不直接开放给 Agent 聊天**

原因：

- 输入条件严格
- 失败门槛明确
- 它首先是一个几何/修图问题，不是开放式设计任务

## 12. 最终判断

如果按“完整自动化形态统一”来理解，这件事当前置信度不高。

如果按“受约束、半自动、能拒绝高风险样本的修图工具”来做，这件事值得推进研究。

所以正确做法不是：

- 直接承诺功能

而是：

- 先做研究
- 再做简单样本验证
- 再决定是否进入产品化
