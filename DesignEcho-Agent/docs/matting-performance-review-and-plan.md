# 抠图性能与资源专项复盘

日期：2026-04-05

## 结论

当前抠图慢、占资源，不是单一模型问题，而是以下几类开销叠加：

1. 图像导出与格式转换过多
2. YOLO-World 与 BiRefNet 串行
3. 主进程热路径日志过重
4. 结果返回形态偏重
5. UXP 侧结果应用与画布刷新有额外开销

这意味着不能只换模型，也不能只调一个参数。需要分层处理。

## 当前真实调用链

### 用户抠图主链

1. `matte-product.executor.ts`
2. `tool-executor.service.ts`
3. `DesignEcho-UXP/src/tools/image/remove-background.ts`
4. `matting:removeBackground`
5. `src/main/services/matting-service.ts`
6. UXP `ApplyMattingResultTool`

### Smart Layout 复用链

1. `smart-layout-handlers.ts`
2. `smart-layout-service.ts`
3. `matting-service.ts`

这说明抠图性能问题不只影响“抠图按钮”，也影响主体检测、智能布局等依赖前景分割的功能。

## 已确认的性能热点

### 1. 图像转换和复制开销

在 `matting-service.ts` 中可以确认：

- `RAW -> PNG Buffer`
- `Base64 -> Buffer`
- `sharp(...).raw().toBuffer()`
- `sharp(...).png().toBuffer()`
- 结果阶段可能再转 `base64`

这会同时消耗：

- CPU
- 内存
- Buffer 分配
- 字符串分配

### 2. YOLO 与 BiRefNet 串行

当前只有在 `targetPrompt` 存在时才会跑 YOLO，这一点是对的。

但一旦进入该路径，当前就是：

1. YOLO-World 定位
2. BiRefNet 分割
3. 蒙版裁剪/限制

这对“语义目标抠图”来说属于双模型串行路径，延迟会显著高于普通抠图。

### 3. 热路径日志过重

`runBiRefNetInference(...)` 和 `runYoloWorldInference(...)` 中存在大量诊断日志，包括：

- 输入尺寸
- contain 布局
- 推理时长
- 输出名称/形状/长度
- logit 范围
- 蒙版统计
- YOLO 检测统计

这些日志对排查有价值，但不应默认在热路径持续打开。

### 4. 结果结构偏重

当前 `removeBackground(...)` 同时支持：

- `maskImage`
- `maskBuffer`
- `mattedImage`
- `analysis`
- `pipeline`

这本身没错，但不同调用场景需要不同返回。若调用方只要 mask，就不应再走额外编码和包装。

### 5. Smart Layout 复用链原先有 Base64 往返

`smart-layout-service.ts` 之前调用：

- `returnMask: true`

但没有开启：

- `binaryMaskOutput: true`

结果是主进程内部仍然要走：

`maskBuffer -> RAW_MASK base64 -> parseMaskData -> Uint8Array`

这是纯额外开销。

## 这次已落地的低风险优化

### A. Smart Layout 改为内部二进制 mask

已修改：

- `src/main/services/smart-layout-service.ts`

改动：

1. 调用 `removeBackground(...)` 时增加 `binaryMaskOutput: true`
2. 优先消费 `maskBuffer/maskWidth/maskHeight`
3. 只有老格式才回退到 `RAW_MASK`

收益：

- 避免主进程内部的 Base64 编码/解码
- 减少字符串分配
- 减少额外 Buffer 拷贝

### B. 抠图热路径日志默认关闭

已修改：

- `src/main/services/matting-service.ts`

改动：

1. 新增 `debugLog(...)`
2. 仅当 `DESIGNECHO_MATTING_DEBUG=1` 时输出热路径诊断日志
3. 保留 `console.warn` / `console.error`

当前已降噪的区域：

- `removeBackground(...)` 热路径部分
- `runBiRefNetInference(...)`
- `runYoloWorldInference(...)`

收益：

- 降低主进程 console I/O 压力
- 降低 Electron 日志桥接压力
- 减少字符串格式化和大对象输出

### C. 导出侧质量档开始真实影响成本

已修改：

- `src/main/uxp-handlers/visual-handlers.ts`
- `DesignEcho-UXP/src/tools/image/remove-background.ts`

改动：

1. `quality` 现在会影响导出最长边，而不是始终走同一默认值
2. 当前导出分档：
   - `fast`: 896
   - `balanced`: 1024
   - `quality`: 1280

注意：

- 这不是让 BiRefNet 推理本身分档
- 这只是在导出、传输、预处理层降低成本

收益：

- 降低图层导出数据量
- 降低 UXP -> Agent 传输负载
- 降低主进程图像预处理开销

### D. Subject Detection 也改为优先消费二进制 mask

已修改：

- `src/main/services/subject-detection-service.ts`

改动：

1. 申请 `binaryMaskOutput: true`
2. 优先读取 `maskBuffer/maskWidth/maskHeight`
3. 仅在旧格式下回退到字符串 mask 解析

收益：

- 避免主体检测链重复做 `RAW_MASK base64` 往返
- 与 `smart-layout` 一样，先清掉主进程内部纯浪费链路

### E. 图层组与二进制失败场景改为二进制优先 fallback

已修改：

- `DesignEcho-UXP/src/tools/image/remove-background.ts`

改动：

1. 图层组不再直接跳过二进制路径
2. 新增 `copyLayerAndExportBinary(...)`
3. 当 `getLayerImageDataBinary(...)` 失败时，不再立刻掉回 Base64，而是先尝试二进制 `copy-export`
4. `copyLayerAndExport(...)` 现在复用统一的临时文档导出逻辑，只在最后一层才把结果转成 Base64
5. 大字节数组转 Base64 增加了分块转换 helper，避免超长字符串逐字节累加

收益：

- 图层组抠图现在也能优先走二进制传输
- `getPixels` 二进制失败时，不再立刻进入字符串重链
- 降低大 PNG/图层组场景下的传输膨胀和字符串分配开销
- 不改变现有功能语义，Base64 仍保留为兼容回退

## 仍然存在的真实问题

### 1. `quality` 当前还不能直接改变 BiRefNet 推理成本

当前：

- `BIREFNET_DEFAULT_INPUT_SIZE = 1024`
- `BIREFNET_BALANCED_INPUT_SIZE = 1024`
- `BIREFNET_FAST_INPUT_SIZE = 1024`

所以当前的真实状态是：

1. `quality` 已经开始影响导出和传输成本
2. 但它还没有影响 BiRefNet 的推理尺寸
3. 因为当前模型链仍按固定 1024 输入工作

### 2. UXP 侧仍保留多条 Base64 fallback

`DesignEcho-UXP/src/tools/image/remove-background.ts` 里仍有：

- Binary export 失败 -> Base64
- JPEG Base64
- RAW Base64
- copy-export fallback（现在已优先支持二进制）
- temp document fallback

这说明：

- 二进制主路径已经存在
- 但 fallback 链仍然偏重

### 3. Smart Layout 仍然以 Base64 作为 IPC 输入

`smart-layout-handlers.ts` 入口还是：

- `imageData: string`

即使内部 mask 已二进制化，入口图像本身仍不是二进制协议。

### 4. MattingService 被 Smart Layout 复用

这在架构上是合理的，但意味着：

- 抠图慢 = 主体检测也慢
- 抠图重 = 智能布局也重

后续如果继续扩依赖链，MattingService 就会成为更明显的资源热点。

## 立即可做的下一批优化

### 1. 让 `quality` 真正控制 BiRefNet 推理成本

建议：

- `fast`: 768
- `balanced`: 896
- `quality`: 1024

风险：

- 会影响边缘质量

因此需要样本回归，不应盲改后直接全量上线。

### 2. 限制非必要返回字段

原则：

- 只要 mask：不生成 `mattedImage`
- 只要主体框：不回传多余分析文本
- 内部服务：优先 `Buffer/Uint8Array`

### 3. 把热路径日志继续集中治理

不仅 `matting-service.ts`，还包括：

- `smart-layout-service.ts`
- UXP `remove-background.ts`
- `index.ts` 中的抠图 UI 过程日志

原则：

- 默认安静
- 调试显式开启

### 4. 控制 UXP 端刷新与状态推送

重点检查：

- `forceRefreshCanvas()`
- 高频 `sendToWebView(...)`
- 长流程中的状态消息密度

## 中期结构改造

### 1. 统一图像二进制通道

目标：

- Renderer -> Main
- UXP -> Agent
- Smart Layout -> Matting

尽量统一成二进制，不再让 Base64 作为主路径。

### 2. 给 MattingService 加队列/并发保护

当前没有看到明确的重任务并发闸门。

如果并发抠多张大图，资源峰值会更高。

### 3. 对 MattingService 做场景分层

拆成更清楚的成本等级：

- 主体框检测
- 普通抠图
- 语义目标抠图

不要所有场景都走相近的重路径。

## 不应夸大的地方

1. 不能承诺短期内把所有抠图慢点一次性清完
2. 不能在不改协议的前提下彻底消灭 Base64
3. 不能把 ONNX 推理本身的真实成本假装成“只是日志问题”

## 建议的推进顺序

1. 先完成低风险优化
2. 再让 `quality` 真正分档
3. 再审 UXP fallback，收紧 Base64 主路径
4. 最后再做队列/并发控制
