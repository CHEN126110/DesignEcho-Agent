# 抠图实现与可靠性复盘

日期：2026-04-05

## 结论

当前抠图主链的真实核心模型是：

1. `BiRefNet`
2. `YOLO-World`（仅在 `targetPrompt` 非空时参与）

最近这轮性能修改里，真正可靠且低风险的有三项：

1. `smart-layout-service.ts` 改为优先消费二进制 mask
2. `subject-detection-service.ts` 改为优先消费二进制 mask
3. `matting-service.ts` 热路径日志默认关闭

`quality` 这轮的改动是有效的，但只在导出/传输/预处理层有效，还没有改变 ONNX 推理成本。

当前最需要纠正的误判有三条：

1. 不能说系统现在真的支持 `u2netp` 等多分割模型切换
2. 不能说选区抠图已经真正按选区约束推理
3. 不能说 `quality` 已经变成完整的成本开关

## 当前真实实现

### 1. 用户面板主抠图链

真实调用链是：

1. `DesignEcho-UXP/src/index.ts`
2. `wsClient.sendRequest('remove-background', ...)`
3. `DesignEcho-Agent/src/main/uxp-handlers/visual-handlers.ts`
4. `wsServer.sendRequest('removeBackground', ...)`
5. `DesignEcho-UXP/src/tools/image/remove-background.ts`
6. `DesignEcho-Agent/src/main/services/matting-service.ts`
7. `wsServer.sendRequest('applyMattingResult', ...)`
8. `DesignEcho-UXP/src/tools/image/remove-background.ts` 中的 `ApplyMattingResultTool`

关键点：

1. Agent 主进程不直接修改 Photoshop
2. UXP 负责导出图层图像
3. Main 负责 ONNX 推理
4. UXP 再负责将 mask/selection/layer 写回 Photoshop

### 2. 源图导出路径

当前 UXP 抠图导出分三层：

1. 二进制主路径
   - `getLayerImageDataBinary(...)`
2. Base64 回退
   - `getLayerImageData(...)`
3. 复制导出重回退
   - `copyLayerAndExport(...)`

实际情况：

1. 非图层组会先尝试二进制导出
2. 图层组会直接跳过 `getPixels` 主路径，进入 `copy-export`
3. 二进制失败时会回退到 Base64
4. Base64 失败时还可能继续回退

这说明二进制主路径已经存在，但还没有做到“绝对主导”。

### 3. 结果回写路径

当前回写主路径也是分层的：

1. 优先回传 `RAW_MASK` 二进制
2. 次级回传 `RAW_MASK` 字符串
3. 兼容 PNG mask

其中真正可靠的主路径是：

1. Agent 返回 `maskBuffer + maskWidth + maskHeight`
2. `visual-handlers.ts` 将其通过 `RAW_MASK` 二进制回给 UXP
3. `ApplyMattingResultTool` 使用 `imaging.putLayerMask()` 或 `putSelection()` 写回

需要明确：

PNG mask 兼容链不是当前最佳路径。当前 `applyPngMaskAsLayerMask()` 仍然带明显的兼容/降级痕迹，不应当被当成主实现。

### 4. 选区抠图真实状态

`remove-background-by-selection` 目前不是一个真正独立的“按选区约束推理”实现。

现在的真实情况是：

1. UXP 先读取 Photoshop 当前选区边界
2. 再发送 `remove-background-by-selection`
3. 但 Agent handler 中：
   - `bbox` 没有参与推理
   - `refineEdges` 没有被消费
   - `quality` 还固定写死为 `balanced`
4. 最终仍然是导出整层并跑普通 `removeBackground(...)`

所以当前它更准确的定义是：

**“带选区前置校验的普通抠图”**

不是：

**“由选区约束的模型推理”**

## 当前真实模型

### 1. 主分割模型

当前主分割模型是：

1. `BiRefNet`

真实证据：

1. `MattingService` 显式加载 `models/birefnet/birefnet.onnx`
2. `removeBackground(...)` 一开始就要求 `loadBiRefNetModel()`
3. 主分割调用是 `runBiRefNetInference(...)`

### 2. 目标检测模型

只有当 `targetPrompt` 非空时，才会额外加载：

1. `YOLO-World`

真实行为：

1. 先 YOLO-World 检测
2. 再 BiRefNet 分割
3. 最后在后处理阶段把 mask 限制到检测区域

需要强调：

这不是“先裁框再局部分割”的轻量实现，而是：

**先检测，再做整图 BiRefNet，再做区域限制**

所以这条路径一定比普通抠图更重。

### 3. `u2netp` 真实状态

`subject-detection-service.ts` 中确实存在：

1. `const modelToUse = options?.model || 'u2netp'`

但从当前代码看：

1. `MattingService.removeBackground()` 虽然声明了 `model?: string`
2. 实现中没有根据 `options.model` 切换分割模型
3. 主逻辑仍然只用 `BiRefNet`

所以这个 `u2netp` 更像：

**历史残留参数**

而不是当前真正有效的模型切换。

## 最近修改的有效性评估

### A. `smart-layout-service.ts` 二进制 mask 直通

判断：

**有效，且低风险。**

原因：

1. 这一步只是去掉主进程内部的 `RAW_MASK` Base64 回转
2. 没有改变模型行为
3. 只是减少字符串和 Buffer 往返

这类改动属于可靠优化。

### B. `subject-detection-service.ts` 二进制 mask 直通

判断：

**就代码局部而言有效，但整体收益要打问号。**

原因：

1. 局部实现确实优先消费了 `maskBuffer`
2. 但当前主装配里没有看到 `subjectDetectionService.setMattingService(...)`
3. 也没有搜到 `detectSubjectBounds(...)` 的活跃调用

所以这项改动的代码方向是对的，但它更像：

**把一条可能未接通的链路修得更合理**

而不是已经证明线上主路径受益。

### C. `matting-service.ts` 热路径日志降噪

判断：

**有效，且低风险。**

原因：

1. 热路径日志本来就会放大 CPU、字符串格式化和 Electron 日志桥接开销
2. 当前改动只关闭默认调试日志
3. `warn/error` 仍然保留

这类改动可以保留。

### D. `quality` 导出分档

判断：

**有效，但边界有限。**

当前真实效果：

1. `fast -> 896`
2. `balanced -> 1024`
3. `quality -> 1280`

它影响的是：

1. UXP 导出尺寸
2. UXP -> Agent 传输负载
3. 主进程预处理成本

它没有影响的是：

1. BiRefNet 推理尺寸
2. 模型选择
3. YOLO 是否启用

因为当前：

1. `BIREFNET_DEFAULT_INPUT_SIZE = 1024`
2. `BIREFNET_BALANCED_INPUT_SIZE = 1024`
3. `BIREFNET_FAST_INPUT_SIZE = 1024`

所以现在不能把它描述成“完整的质量/成本分档”。

## 当前不够可靠的地方

### 1. 选区抠图刚刚收正，但仍然不是完整的“选区引导推理”

当前 `remove-background-by-selection` 已完成两项关键修正：

1. `bbox` 不再是假参数
2. `quality` 不再固定写死为 `balanced`

现在的真实行为变成：

1. UXP 发送规范字段 `bbox`
2. Agent handler 同时兼容旧字段 `box`
3. Main 会把选区框转换到图层局部坐标
4. `MattingService` 会把它投影到最终 mask 空间
5. 在 BiRefNet 推理之后，真实把 mask 限制在用户选区范围内

但仍然需要明确：

1. 这仍然不是“把选区直接作为模型输入提示”
2. 当前实现是 **后处理约束**
3. `refineEdges` 现在只是轻量接回边缘模式选择，不是独立算法分支

所以这条链现在可以叫：

**“选区约束抠图”**

但还不能叫：

**“选区引导推理抠图”**

### 2. `SubjectDetectionService` 可能未接通

当前看到的是：

1. 服务被实例化
2. 但没看到 `setMattingService(...)`
3. 也没看到 `detectSubjectBounds(...)` 的活跃调用

这说明后续不能把它当成“已证明在运行中的热点路径”。

### 3. 图层组导出仍然很重

图层组现在直接跳过二进制 `getPixels` 路径，走：

1. 复制图层
2. 临时文档
3. 导出 PNG
4. 再读回

这对大图层组一定重。

### 4. PNG mask 路径仍然不是可靠主路径

当前 RAW_MASK 路径明显更成熟。PNG 分支还带着明显的兼容和临时路径，不适合继续作为性能优化主方向。

## 当前最可靠的结论

### 可以确认的

1. 当前真实分割模型是 `BiRefNet`
2. `targetPrompt` 会触发 `YOLO-World + BiRefNet` 串行
3. 最近的二进制 mask 直通优化是真有效的
4. 热路径日志降噪是真有效的
5. `quality` 现在只在导出侧生效，不在推理侧生效

### 不能继续说的

1. 不能说系统现在有多分割模型切换
2. 不能说选区抠图已经真正被选区约束
3. 不能说 `quality` 已经成为完整性能开关

## 下一步建议

优先级应该是：

1. 先统一并收实 panel 两条抠图路径
   - `remove-background`
   - `remove-background-by-selection`
2. 再决定 `SubjectDetectionService` 是继续接通还是正式下线
3. 再处理图层组导出的重 fallback
4. 最后才考虑让 `quality` 真正进入推理成本分档

更具体地说：

### 优先级 1

继续把 `remove-background-by-selection` 从“后处理约束”推进到更一致的产品路径：

1. 评估是否要把当前 `bbox` 约束前移到导出阶段，减少无意义的整层推理区域
2. 明确 UI 对这条路径的文案，不再暗示“真正的选区引导推理”
3. 决定 `refineEdges` 是否保留为正式参数，还是继续收窄

### 优先级 2

清理 `subject-detection-service` 的状态：

1. 如果真的不用，就不要再让 `u2netp` 这种残留参数继续误导
2. 如果要用，就把依赖注入和调用链接实

### 优先级 3

审 `copyLayerAndExport()`：

1. 哪些 fallback 必须保留
2. 哪些只是历史路径
3. 图层组是否能做更轻的导出

### 优先级 4

如果后面真要让 `quality` 影响推理成本，必须先做样本回归，再决定是否引入真实 fast-path。
