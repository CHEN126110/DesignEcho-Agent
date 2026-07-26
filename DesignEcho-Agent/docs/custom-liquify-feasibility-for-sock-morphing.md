# 自建“液化/变形系统”可行性判断

## 1. 问题

我们是否应该依赖 Photoshop 自带 Liquify 来实现袜子形态统一？

结论：

- **不应该把核心能力建立在 Photoshop Liquify 上**
- **应该评估并建设自己的位移/变形系统**

## 2. 为什么不依赖 Photoshop Liquify

### 2.1 我没有找到官方公开的、可参数化控制的 Liquify UXP API

Adobe 官方 UXP 文档公开的是：

- DOM API
- `batchPlay`
- Imaging API（`getPixels` / `putPixels`）

但没有公开、文档化的 Liquify 参数接口。

参考：

- [Photoshop UXP batchPlay](https://developer.adobe.com/photoshop/uxp/2022/ps_reference/media/batchplay/)
- [Photoshop UXP Imaging API](https://developer.adobe.com/photoshop/uxp/2022/ps_reference/media/imaging/)
- [Photoshop API Reference](https://developer.adobe.com/photoshop/uxp/ps_reference)

这意味着：

- 即使能通过某些内部 action descriptor 触发 Liquify
- 也没有稳定、官方支持的参数契约可以依赖

对于我们这种要做成产品能力的功能，这个依赖风险太高。

### 2.2 Liquify 就算能调，也不等于适合做这个功能

袜子形态统一要求：

- 统一轮廓
- 保持纹理自然
- 图案不明显变形
- 袜口异形不扭曲

Liquify 更适合：

- 人工局部修形
- 视觉修整

不适合直接作为：

- 批量
- 可验证
- 可拒绝
- 受约束

的核心算法引擎。

## 3. 当前仓库里已经有什么

### 3.1 UXP 侧已经有位移写回能力

文件：

- [apply-displacement.ts](C:\DesignEcho\DesignEcho-UXP\src\tools\morphing\apply-displacement.ts)

当前实现是真实有效的：

- 读取图层像素 `imaging.getPixels`
- 反序列化稀疏位移场
- 解压为完整位移场
- 做双线性插值
- 最终写回 `imaging.putPixels`

这说明：

**我们已经具备“自己做变形，再把结果写回 Photoshop”的关键基础。**

### 3.2 Agent/Main 侧已经有更接近真实算法内核的代码

文件：

- [enhanced-morph-executor.ts](C:\DesignEcho\DesignEcho-Agent\src\main\services\morphing\enhanced-morph-executor.ts)
- [optimized-morphing-service.ts](C:\DesignEcho\DesignEcho-Agent\src\main\services\morphing\optimized-morphing-service.ts)

现有能力包括：

- MLS deformation
- 内容分析
- 袜子区域分析
- 区域感知匹配
- 图案保护
- 位移场生成

所以从工程角度看：

**更现实的方向是把这些现有模块整理成一个正式的自建变形系统。**

## 4. 能不能自己做一个“液化系统”

能，但不要把它理解成“重做 Photoshop Liquify”。

更准确地说，我们可以做的是：

**为袜子形态统一定制一个受约束的图像变形系统。**

它和 Photoshop Liquify 的区别是：

- 不是通用万能工具
- 是针对袜子这种特定对象的变形引擎
- 重点是：
  - 轮廓统一
  - 袜口保护
  - 图案/纹理保护
  - 质量验证

## 5. 最现实的技术路线

推荐路线：

### Stage 1：分析

- 主体 mask
- contour
- cuff 区域
- pattern/logo/text 区域
- skeleton / landmarks

### Stage 2：规划

- 粗对齐
- 目标轮廓对应
- 保护区约束
- 生成位移场 / mesh warp plan

### Stage 3：执行

- Agent/Main 侧计算位移
- UXP 侧 `getPixels -> warp -> putPixels`
- 非破坏性写回到复制层/智能对象

### Stage 4：验证

- shape match
- cuff distortion
- pattern strain
- local shear

失败直接拒绝执行。

## 6. 这条路线的好处

### 6.1 可控

我们能自己定义：

- 什么区域可以动
- 什么区域不能动
- 形变强度
- 失败阈值

### 6.2 可验证

不像手工 Liquify 那样主要靠眼睛判断。  
我们可以直接算：

- 轮廓误差
- 局部应变
- 图案区剪切

### 6.3 可产品化

这条链更适合未来做成：

- 内部修图 operation
- 参数预设
- 批量处理
- 失败拒绝

## 7. 这条路线的难点

### 7.1 不是简单小功能

难点在于：

- 输入质量
- 对应关系
- 保护区约束
- 写回质量

### 7.2 内存和性能

`getPixels / putPixels` 是能做，但并不便宜。

对大图意味着：

- 内存占用高
- 插值计算开销大
- 批量时性能压力明显

### 7.3 只能先支持像素层

当前 `putPixels` 要求目标层是像素图层。  
这意味着：

- shape layer
- text layer
- smart object

最终都得走：

- 栅格化副本
- 或 smart object 替换型写回策略

### 7.4 不能先承诺复杂样本

像：

- 花边
- 木耳边
- 大图案
- 大文字
- 严重姿态差异

都不适合第一版。

## 8. 最合理的产品边界

这件事不该做成：

- 通用液化工具
- 用户聊天直接调用的 Agent skill

更适合做成：

- 内部修图 operation
- 面板中有明确参数和预览
- 先支持简单袜子样本

## 9. 最终判断

### 可以明确说的

1. **不应该依赖 Photoshop Liquify API**
2. **可以建设自定义变形系统**
3. **现有仓库已经有一部分基础代码**
4. **这条路线比依赖 Liquify 更可控，也更适合产品化**

### 必须保守说的

1. 这不是“很快补一层代码”能成的
2. 第一版只能做受约束样本
3. 复杂袜口和复杂图案现在不能承诺

## 10. 建议下一步

1. 先审计当前真实调用链和参数契约
2. 收口成：
   - analyzer
   - planner
   - validator
   - executor
3. 做一个只支持简单样本的 prototype
4. 再决定是否扩到复杂袜口和复杂图案
