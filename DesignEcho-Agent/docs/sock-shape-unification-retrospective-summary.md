# 袜子形态统一系统复盘与总结

## 1. 目的

这份文档是当前“袜子形态统一”议题的**规范化总文档**。

目标不是继续扩写方案，而是把以下内容固定下来：

1. 我们到底在研究什么
2. 当前代码真实情况是什么
3. 这件事的技术难度和可行性判断是什么
4. 已经明确的产品边界是什么
5. 下一步应该做什么
6. 什么情况下应该继续，什么情况下应该停止

后续如果要恢复这个议题，优先读这份文档，而不是依赖聊天历史。

## 2. 问题定义

目标能力：

- 用户导入多张袜子图
- 用户绘制一个参考形状图层
- 系统把不规则袜子调整成统一形态

同时要求：

- 形态自然、工整
- 针织纹理尽量整齐
- 图案/Logo/文字不明显变形
- 袜口异形结构尽量保护：
  - 花边
  - 木耳边
  - 平口
  - 卷边

这不是普通 Warp，也不是简单轮廓对齐。  
它本质上是一个：

**受约束的、分区保护的图像变形问题**

## 3. 当前代码真实情况

### 3.1 仓库里已经有一批相关实现

主要文件：

- [shape-morphing.executor.ts](C:\DesignEcho\DesignEcho-Agent\src\renderer\services\skill-executors\shape-morphing.executor.ts)
- [morph-executor.ts](C:\DesignEcho\DesignEcho-UXP\src\tools\morphing\morph-executor.ts)
- [tool-classes.ts](C:\DesignEcho\DesignEcho-UXP\src\tools\morphing\tool-classes.ts)
- [contour-detector.ts](C:\DesignEcho\DesignEcho-UXP\src\tools\morphing\contour-detector.ts)
- [apply-displacement.ts](C:\DesignEcho\DesignEcho-UXP\src\tools\morphing\apply-displacement.ts)
- [sock-morph-engine.ts](C:\DesignEcho\DesignEcho-Agent\src\main\services\sock-morphing\sock-morph-engine.ts)
- [sock-morph-integration.ts](C:\DesignEcho\DesignEcho-Agent\src\main\services\sock-morphing\sock-morph-integration.ts)
- [optimized-morphing-service.ts](C:\DesignEcho\DesignEcho-Agent\src\main\services\morphing\optimized-morphing-service.ts)
- [enhanced-morph-executor.ts](C:\DesignEcho\DesignEcho-Agent\src\main\services\morphing\enhanced-morph-executor.ts)

### 3.2 但当前主链不可靠

已经确认的事实：

1. 当前对外 skill 很薄，只负责转参数。
2. UXP 侧更多停留在“准备变形数据”，不是完整主流程。
3. integration 里还有未完成分支。
4. contour 检测失败时会退到 bounding box。
5. 当前参数契约存在不一致。

最明显的例子：

- `shapeMorphingExecutor` 传：
  - `refShapeLayerId`
  - `productLayerIds`
- `MorphToShapeTool` 定义的是：
  - `targetShapeLayerId`
  - `sourceLayerId`

这说明当前链路甚至很可能没有正确跑通。

### 3.3 已有代码里真正有价值的部分

1. `apply-displacement.ts`
- 已经具备：
  - `getPixels`
  - 位移场反序列化
  - 双线性插值
  - `putPixels` 写回

2. `enhanced-morph-executor.ts`
- 已经具备：
  - MLS deformation
  - 内容分析
  - 区域分析
  - 区域感知匹配
  - 图案保护

3. `optimized-morphing-service.ts`
- 已经在尝试：
  - 稀疏位移场
  - cuff 保护
  - 变形优化

结论：

仓库不是没有基础，而是：

**基础模块存在，但没有形成一条统一、可验证、可交付的主链。**

## 4. 可行性判断

### 4.1 高自动化、强泛化版本

例如：

- 自动处理各种袜型
- 自动保护各种袜口异形
- 图案基本不变形
- 直接可商用批量处理

当前判断：

**置信度低**

不能承诺。

### 4.2 受约束、半自动版本

例如：

- 单只袜子
- 参考形状明确
- 简单袜口
- 简单图案
- 高风险拒绝执行

当前判断：

**置信度中等**

值得做原型验证。

## 5. 真正的技术难点

### 5.1 袜口保护

最难点之一。

原因：

- 花边/木耳边/卷边不是简单轮廓
- 与袜身连接处容易被拉坏
- 自动识别和局部保护都难

### 5.2 图案保护

图案、文字、Logo 对：

- 剪切
- 拉伸
- 方向扭转

极敏感。  
这不是普通轮廓 matching 就能解决的。

### 5.3 针织纹理自然

即使没有明显图案，针织纹理也会因为局部形变显得“不工整”。

### 5.4 Photoshop 写回

即使算法 plan 正确，最后写回 Photoshop 时仍会面临：

- 位移场应用
- 像素写回质量
- 性能和内存
- 图层类型兼容

## 6. 已明确否定的路线

### 6.1 不依赖 Photoshop Liquify 作为核心

原因：

- 没有找到稳定、官方支持的参数化 UXP API
- 就算能触发，也不适合作为可产品化主算法

更合理的是：

**自己建设位移/网格变形系统**

### 6.2 不做单一全局 Warp/TPS

原因：

- 容易把袜口和图案一起拉坏

TPS 可以用于粗对齐，但不适合当最终主变形。

### 6.3 不把它做成用户聊天直接触发的 Agent skill

当前阶段它更适合：

- 内部修图 operation
- 面板工具
- 参数明确
- 结果可验证

## 7. 当前最合理的技术路线

推荐路线：

1. 主体分割与精细 contour
2. 袜子语义分区
   - cuff
   - leg
   - heel
   - foot
   - toe
   - patterned areas
3. contour / skeleton / landmark 对应
4. 全局粗对齐
5. 分区约束变形
6. 质量验证
7. 写回 Photoshop

推荐的第一阶段变形方法：

- 全局对齐
- 边缘带 MLS 变形
- cuff freeze

更进一步的方法：

- 分区 ARAP 网格变形

不建议第一阶段采用：

- 全局 TPS 主变形
- CPD + dense warp 作为主路径

## 8. 产品边界

### 当前建议定位

不是：

- 万能一键形态统一
- 通用液化工具
- 对话型 Agent 设计能力

而是：

**内部修图 operation**

### 适合第一阶段支持的范围

- 单只平铺袜子
- 参考形状明确
- 简单平口 / 简单卷边
- 纯色或低密度图案
- 中小形变差异

### 当前不应承诺

- 复杂花边/镂空袜口
- 大面积复杂提花/文字
- 高自动化批量生产
- 通吃所有袜型

## 9. 可行性研究必须回答的问题

1. contour 能不能稳定拿到？
2. cuff 保护能不能稳定成立？
3. pattern 保护是否能做到“够用”？
4. 全局对齐 + 边缘带 warp 是否足够？
5. 在 Photoshop 写回阶段，什么路径副作用最小？

## 10. 样本与验证标准

### 建议研究样本

先做 **120 张**。

覆盖：

- 背景：
  - 纯白
  - 浅色棚拍
  - 干扰背景
- 姿态：
  - 平铺
  - 穿着直立
  - 弯折/倾斜
- 图案复杂度：
  - 纯色
  - 轻纹理
  - 明显图案/Logo
- 袜口类型：
  - 平口
  - 罗纹/卷边
  - 轻装饰

### 通过标准

1. silhouette IoU 达标
2. cuff 畸变率可接受
3. 图案剪切率可接受
4. 人工补救时间足够低

### 停止条件

出现以下任一情况，应收缩目标或停止：

- catastrophic failure 太高
- cuff 保护不稳定
- 图案类样本大面积失败
- contour 质量经常不足

## 11. 从像素蛋糕得到的产品启发

参考调研文档：
- [pixcake-morphology-capability-study.md](C:\DesignEcho\DesignEcho-Agent\docs\pixcake-morphology-capability-study.md)

最有价值的启发不是它的私有算法，而是产品结构：

1. 自动能力
2. 手动保护/修正能力
3. 预设和批量复用能力

这说明更现实的产品方向是：

- 自动统一
- 保护区和局部修正
- 参数/模板预设

而不是单一黑盒。

## 12. 已产出的研究文档

当前相关文档：

- [sock-shape-unification-research-and-plan.md](C:\DesignEcho\DesignEcho-Agent\docs\sock-shape-unification-research-and-plan.md)
- [sock-shape-unification-feasibility-study.md](C:\DesignEcho\DesignEcho-Agent\docs\sock-shape-unification-feasibility-study.md)
- [custom-liquify-feasibility-for-sock-morphing.md](C:\DesignEcho\DesignEcho-Agent\docs\custom-liquify-feasibility-for-sock-morphing.md)
- [pixcake-morphology-capability-study.md](C:\DesignEcho\DesignEcho-Agent\docs\pixcake-morphology-capability-study.md)

这份文档是上述内容的总入口。

## 13. 下一步

下一步不应该直接写大段算法代码。

应按顺序做：

1. **当前调用链真相审计**
   - UI -> executor -> tool -> main service -> Photoshop 写回

2. **参数契约修正**
   - 清掉当前 `shapeMorphingExecutor` 与 `MorphToShapeTool` 的不一致

3. **定义研究型 prototype 结构**
   - analyzer
   - planner
   - validator
   - executor

4. **做第一阶段 prototype**
   - 只支持简单样本
   - 全局对齐 + 边缘带 MLS + cuff freeze

5. **基于样本集做验证**
   - 达不到门槛就收缩目标

## 14. 最终结论

这项能力不是伪需求，也不是完全空想。

但它当前也绝不是：

- 一个简单 Warp 工具
- 一个很快能交付的功能
- 一个适合直接开放给 Agent 的技能

更严谨的结论是：

**它值得做，但必须先作为“受约束的修图工具研究项目”推进，而不是直接当成熟功能开发。**
