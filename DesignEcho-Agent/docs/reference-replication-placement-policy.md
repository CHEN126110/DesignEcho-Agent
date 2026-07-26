# 参考图复刻 placement policy 最小结构

## 1. 目的

本文件定义参考图复刻中“图片放在哪里、放多大、如何裁切”的最小结构。

这一步先定义接口，不声称已经完成真实落位算法。

## 2. 当前新增文件

- `src/shared/reference-replication-placement.ts`

## 3. 为什么现在需要这层

当前项目已经开始把：

1. 参考图解析
2. 最小中间表示
3. blueprint 推导

从 executor 中抽出来。

如果后续继续推进参考图复刻，图片落位不能长期靠模型临场描述，必须有明确的策略结构。

## 4. 当前最小结构

当前定义了：

### 4.1 PlacementBox

表示目标区域：

1. `x`
2. `y`
3. `width`
4. `height`

### 4.2 PlacementPolicy

表示落位策略：

1. `assetKind`
2. `scaleMode`
3. `anchor`
4. `cropPolicy`
5. `preserveSubject`
6. `preserveEdges`

### 4.3 PlacementPlan

表示某个元素最终应如何落位：

1. `elementId`
2. `targetBox`
3. `safeBox`
4. `policy`
5. `notes`

## 5. 当前支持的最小策略枚举

### 5.1 scaleMode

1. `contain`
2. `cover`
3. `focus-safe`
4. `fit-width`
5. `fit-height`

### 5.2 anchor

1. `center`
2. `top`
3. `bottom`
4. `left`
5. `right`
6. `top-left`
7. `top-right`
8. `bottom-left`
9. `bottom-right`

### 5.3 cropPolicy

1. `none`
2. `allow-crop`
3. `avoid-crop`
4. `protect-subject`

## 6. 当前边界

已完成：

1. 结构定义

未完成：

1. 参考图到 placement policy 的推导逻辑
2. 对主体边界的真实感知
3. 落位算法
4. 与 Photoshop 图像替换链路的接通

## 7. 下一步

下一步应做：

1. 选 1-2 类高频场景定义默认策略
2. 让 benchmark case 能记录 placement 相关评分
3. 再考虑把 placement policy 接入 executor
