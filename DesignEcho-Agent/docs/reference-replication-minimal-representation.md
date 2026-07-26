# 参考图复刻最小中间表示

## 1. 目的

本文件记录 `M1` 第一阶段落地的“最小中间表示”方案。

目标不是一次性做成完整 DSL，而是先解决当前最实际的问题：

1. 不再让 `layout-replication.executor` 同时定义解析 prompt、解析结果结构和执行输入结构
2. 让“参考图解析结果”与“执行器消费的数据”分开
3. 为后续 placement policy、recipe、QA 留出稳定接口

## 2. 当前新增的共享模块

文件：

- `src/shared/reference-replication.ts`

当前提供：

1. `buildReferenceParsePrompt`
2. `parseJsonObject`
3. `normalizeReferenceParseResult`
4. `buildMinimalDesignRepresentation`

## 3. 两层结构

## 3.1 ReferenceParseResult

用途：

- 表示视觉模型对参考图的直接解析结果

特点：

- 允许仍然带有“解析味道”
- 更接近模型输出

包含：

1. `layoutType`
2. `designIntent`
3. `canvasSize`
4. `composition`
5. `elements`
6. `alignmentGroups`

## 3.2 MinimalDesignRepresentation

用途：

- 表示执行器当前消费的最小可执行设计表示

特点：

- 收敛成执行链更稳定的结构
- 不直接暴露模型原始输出形态

包含：

1. `canvas`
2. `layout`
3. `elements`
4. `alignmentGroups`

其中每个元素至少包含：

1. `id`
2. `sourceType`
3. `name`
4. `role`
5. `nodeKind`
6. `content`
7. `box`
8. `relation`
9. `visualWeight`
10. `zIndex`

## 4. 当前边界

这一步完成后，当前边界变为：

### 已经抽出的部分

1. 参考图解析 prompt
2. 解析结果归一化
3. 最小中间表示构建

### 仍在 executor 内的部分

1. 模板骨架推导
2. 文档创建
3. 图层创建
4. 自动填充
5. 匹配执行

## 5. 当前结论

这一步的意义不是“参考图复刻已经完成”，而是：

1. executor 开始从“混合推理器”退成“消费共享表示的执行器”
2. 后续可以继续把 blueprint / placement / QA 往共享层或独立模块抽

## 6. 下一步

下一步应继续做：

1. 明确 blueprint 输入输出边界
2. 建 benchmark case
3. 再决定 placement policy 的结构
