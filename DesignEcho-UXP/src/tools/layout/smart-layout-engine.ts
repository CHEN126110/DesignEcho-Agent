/**
 * 智能布局引擎
 * 
 * 解决的问题：
 * 1. 如何确定合适的尺寸？→ 基于主体边界 + 填充比例规则
 * 2. 如何保证位置正确？→ 基于视觉重心对齐
 * 3. 如何保证多素材一致？→ 统一缩放因子 + 对齐规则
 * 
 * 核心公式：
 * - 理想缩放比例 = 目标区域 × 填充比例 / 主体尺寸
 * - 主体尺寸 = 通过抠图模型或边缘检测获取的实际内容边界
 */

const { app, core, action } = require('photoshop');

// ==================== 类型定义 ====================

/**
 * 边界框
 */
export interface BoundingBox {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
}

/**
 * 布局配置
 */
export interface LayoutConfig {
    /** 填充比例 (0-1)，主体占目标区域的比例 */
    fillRatio: number;
    /** 最小填充比例 */
    minFillRatio: number;
    /** 最大填充比例 */
    maxFillRatio: number;
    /** 对齐方式 */
    alignment: 'center' | 'top' | 'bottom' | 'left' | 'right' | 'visual-center';
    /** 是否保持宽高比 */
    maintainAspectRatio: boolean;
    /** 安全边距比例 (相对于目标区域) */
    safeMarginRatio: number;
}

/**
 * 缩放计算结果
 */
export interface ScaleResult {
    /** 统一缩放比例 (百分比) */
    scale: number;
    /** 目标位置 */
    targetPosition: { x: number; y: number };
    /** 预期最终尺寸 */
    expectedSize: { width: number; height: number };
    /** 预期填充比例 */
    actualFillRatio: number;
    /** 是否需要调整 */
    needsAdjustment: boolean;
    /** 警告信息 */
    warnings: string[];
}

/**
 * 默认布局配置 - 电商产品图规范
 */
export const DEFAULT_ECOMMERCE_CONFIG: LayoutConfig = {
    fillRatio: 0.75,        // 主体占 75% 区域
    minFillRatio: 0.65,     // 最小 65%
    maxFillRatio: 0.85,     // 最大 85%
    alignment: 'visual-center',
    maintainAspectRatio: true,
    safeMarginRatio: 0.05   // 5% 安全边距
};

/**
 * SKU 组合图配置 - 多产品排列
 */
export const SKU_COMBO_CONFIG: LayoutConfig = {
    fillRatio: 0.80,        // 稍大，因为多个产品需要紧凑
    minFillRatio: 0.70,
    maxFillRatio: 0.90,
    alignment: 'center',
    maintainAspectRatio: true,
    safeMarginRatio: 0.03   // 3% 边距
};

// ==================== 核心算法 ====================

/**
 * 计算图层的实际内容边界（排除透明区域）
 * 
 * 这是智能布局的关键 - 获取真实的主体边界而不是整个图层边界
 */
export async function getContentBounds(layer: any): Promise<BoundingBox | null> {
    try {
        // 方法1: 使用图层的 bounds 属性
        const bounds = layer.bounds;
        if (!bounds) return null;

        // 转换为统一格式
        const box: BoundingBox = {
            left: bounds.left ?? bounds[0]?.value ?? bounds[0],
            top: bounds.top ?? bounds[1]?.value ?? bounds[1],
            right: bounds.right ?? bounds[2]?.value ?? bounds[2],
            bottom: bounds.bottom ?? bounds[3]?.value ?? bounds[3],
            width: 0,
            height: 0
        };
        box.width = box.right - box.left;
        box.height = box.bottom - box.top;

        return box;
    } catch (error: any) {
        console.error('[SmartLayout] 获取边界失败:', error);
        return null;
    }
}

/**
 * 计算智能缩放比例
 * 
 * 核心公式：scale = (targetArea × fillRatio) / sourceArea
 * 
 * @param sourceBounds 源图层边界（主体边界）
 * @param targetBounds 目标区域边界（模板占位区域）
 * @param config 布局配置
 */
export function calculateSmartScale(
    sourceBounds: BoundingBox,
    targetBounds: BoundingBox,
    config: LayoutConfig = DEFAULT_ECOMMERCE_CONFIG
): ScaleResult {
    const warnings: string[] = [];

    // 1. 计算安全区域（去除边距）
    const safeMargin = Math.min(targetBounds.width, targetBounds.height) * config.safeMarginRatio;
    const safeWidth = targetBounds.width - 2 * safeMargin;
    const safeHeight = targetBounds.height - 2 * safeMargin;

    // 2. 计算理想尺寸（基于填充比例）
    const idealWidth = safeWidth * config.fillRatio;
    const idealHeight = safeHeight * config.fillRatio;

    // 3. 计算缩放比例（保持宽高比）
    let scaleX = idealWidth / sourceBounds.width;
    let scaleY = idealHeight / sourceBounds.height;
    let scale: number;

    if (config.maintainAspectRatio) {
        // 取较小值以确保完全适应
        scale = Math.min(scaleX, scaleY);
    } else {
        // 使用平均值（拉伸填充）
        scale = (scaleX + scaleY) / 2;
    }

    // 4. 检查是否在合理范围内
    const scaledWidth = sourceBounds.width * scale;
    const scaledHeight = sourceBounds.height * scale;
    const actualFillRatioX = scaledWidth / safeWidth;
    const actualFillRatioY = scaledHeight / safeHeight;
    const actualFillRatio = Math.max(actualFillRatioX, actualFillRatioY);

    // 5. 调整到合理范围
    let needsAdjustment = false;
    if (actualFillRatio < config.minFillRatio) {
        // 太小，需要放大
        const adjustFactor = config.minFillRatio / actualFillRatio;
        scale *= adjustFactor;
        warnings.push(`素材较小，已放大 ${((adjustFactor - 1) * 100).toFixed(0)}%`);
        needsAdjustment = true;
    } else if (actualFillRatio > config.maxFillRatio) {
        // 太大，需要缩小
        const adjustFactor = config.maxFillRatio / actualFillRatio;
        scale *= adjustFactor;
        warnings.push(`素材较大，已缩小 ${((1 - adjustFactor) * 100).toFixed(0)}%`);
        needsAdjustment = true;
    }

    // 6. 计算目标位置（居中对齐）
    const finalWidth = sourceBounds.width * scale;
    const finalHeight = sourceBounds.height * scale;

    let targetX: number;
    let targetY: number;

    switch (config.alignment) {
        case 'top':
            targetX = targetBounds.left + (targetBounds.width - finalWidth) / 2;
            targetY = targetBounds.top + safeMargin;
            break;
        case 'bottom':
            targetX = targetBounds.left + (targetBounds.width - finalWidth) / 2;
            targetY = targetBounds.bottom - safeMargin - finalHeight;
            break;
        case 'left':
            targetX = targetBounds.left + safeMargin;
            targetY = targetBounds.top + (targetBounds.height - finalHeight) / 2;
            break;
        case 'right':
            targetX = targetBounds.right - safeMargin - finalWidth;
            targetY = targetBounds.top + (targetBounds.height - finalHeight) / 2;
            break;
        case 'visual-center':
            // 视觉居中：稍微偏上（黄金比例）
            targetX = targetBounds.left + (targetBounds.width - finalWidth) / 2;
            const goldenRatio = 0.382;  // 黄金分割
            targetY = targetBounds.top + (targetBounds.height - finalHeight) * goldenRatio;
            break;
        case 'center':
        default:
            targetX = targetBounds.left + (targetBounds.width - finalWidth) / 2;
            targetY = targetBounds.top + (targetBounds.height - finalHeight) / 2;
            break;
    }

    // 7. 边界检查
    if (targetX < targetBounds.left) {
        targetX = targetBounds.left + safeMargin;
        warnings.push('素材左侧超出边界，已调整');
    }
    if (targetY < targetBounds.top) {
        targetY = targetBounds.top + safeMargin;
        warnings.push('素材顶部超出边界，已调整');
    }
    if (targetX + finalWidth > targetBounds.right) {
        targetX = targetBounds.right - finalWidth - safeMargin;
        warnings.push('素材右侧超出边界，已调整');
    }
    if (targetY + finalHeight > targetBounds.bottom) {
        targetY = targetBounds.bottom - finalHeight - safeMargin;
        warnings.push('素材底部超出边界，已调整');
    }

    return {
        scale: scale * 100,  // 转换为百分比
        targetPosition: { x: targetX, y: targetY },
        expectedSize: { width: finalWidth, height: finalHeight },
        actualFillRatio: finalWidth / safeWidth,
        needsAdjustment,
        warnings
    };
}

/**
 * 计算多素材统一缩放比例
 * 
 * 用于 SKU 组合场景，确保多个素材大小一致
 */
export function calculateUnifiedScale(
    sourceItems: BoundingBox[],
    targetBounds: BoundingBox,
    config: LayoutConfig = SKU_COMBO_CONFIG
): { unifiedScale: number; individualResults: ScaleResult[] } {
    // 1. 计算每个素材的理想缩放比例
    const individualResults = sourceItems.map(source => 
        calculateSmartScale(source, targetBounds, config)
    );

    // 2. 取最小缩放比例作为统一缩放（确保最大的素材也能适应）
    const scales = individualResults.map(r => r.scale);
    const unifiedScale = Math.min(...scales);

    // 3. 更新每个结果使用统一缩放
    individualResults.forEach(result => {
        const originalScale = result.scale;
        result.scale = unifiedScale;
        if (Math.abs(originalScale - unifiedScale) > 1) {
            result.warnings.push(`使用统一缩放: ${unifiedScale.toFixed(1)}% (原: ${originalScale.toFixed(1)}%)`);
            result.needsAdjustment = true;
        }
    });

    return { unifiedScale, individualResults };
}

// ==================== 执行函数 ====================

/**
 * 应用智能缩放到图层
 */
export async function applySmartScale(
    layer: any,
    scaleResult: ScaleResult
): Promise<{ success: boolean; error?: string }> {
    try {
        await core.executeAsModal(async () => {
            // 1. 选中图层
            const doc = app.activeDocument;
            if (!doc) throw new Error('没有打开的文档');
            (doc as any).activeLayer = layer;

            // 2. 获取当前边界
            const currentBounds = layer.bounds;
            const currentLeft = currentBounds.left ?? currentBounds[0]?.value ?? currentBounds[0];
            const currentTop = currentBounds.top ?? currentBounds[1]?.value ?? currentBounds[1];

            // 3. 应用缩放
            if (Math.abs(scaleResult.scale - 100) > 0.5) {
                layer.resize(scaleResult.scale, scaleResult.scale);
            }

            // 4. 移动到目标位置
            const newBounds = layer.bounds;
            const newLeft = newBounds.left ?? newBounds[0]?.value ?? newBounds[0];
            const newTop = newBounds.top ?? newBounds[1]?.value ?? newBounds[1];

            const offsetX = scaleResult.targetPosition.x - newLeft;
            const offsetY = scaleResult.targetPosition.y - newTop;

            if (Math.abs(offsetX) > 0.5 || Math.abs(offsetY) > 0.5) {
                layer.translate(offsetX, offsetY);
            }

        }, { commandName: '智能布局调整' });

        return { success: true };
    } catch (error: any) {
        console.error('[SmartLayout] 应用缩放失败:', error);
        return { success: false, error: error.message };
    }
}

// ==================== 智能排列（参考 6.1 颜色排列脚本） ====================

/**
 * 智能排列配置
 */
export interface SmartArrangeConfig {
    /** 间距比例（相对于单个素材宽度），默认 0.55 */
    spacingRatio: number;
    /** 垂直偏移百分比（相对于目标区域高度），正值下移，默认 5% */
    verticalOffsetPercent: number;
    /** 是否自动缩放以适应目标区域，默认 true */
    autoScale: boolean;
    /** 最大缩放比例，防止过度放大，默认 150% */
    maxScale: number;
    /** 最小缩放比例，防止过度缩小，默认 30% */
    minScale: number;
}

/**
 * 智能排列默认配置
 */
export const DEFAULT_ARRANGE_CONFIG: SmartArrangeConfig = {
    spacingRatio: 0.55,
    verticalOffsetPercent: 5,
    autoScale: true,
    maxScale: 150,
    minScale: 30
};

/**
 * 智能排列结果
 */
export interface ArrangeResult {
    /** 是否成功 */
    success: boolean;
    /** 排列的图层 ID 列表 */
    arrangedLayerIds: number[];
    /** 应用的缩放比例（百分比） */
    appliedScale: number;
    /** 最终边界 */
    finalBounds: BoundingBox;
    /** 消息 */
    message: string;
}

/**
 * 智能排列多个图层组（核心算法）
 * 
 * 参考 6.1颜色排列-动态调整.jsx 的核心思路：
 * 1. 先按等间距水平排列所有图层组
 * 2. 编组 → 整体缩放到适应目标区域 → 居中 → 取消编组
 * 
 * 优势：
 * - 不需要精确的占位符
 * - 用户只需绘制一个大致区域
 * - 自动计算间距和大小
 * 
 * @param layerIds 要排列的图层（组）ID 列表
 * @param targetBounds 目标区域（用户绘制的占位矩形或指定区域）
 * @param config 排列配置
 */
export async function smartArrangeLayerGroups(
    layerIds: number[],
    targetBounds: BoundingBox,
    config: SmartArrangeConfig = DEFAULT_ARRANGE_CONFIG
): Promise<ArrangeResult> {
    if (!layerIds || layerIds.length === 0) {
        return {
            success: false,
            arrangedLayerIds: [],
            appliedScale: 100,
            finalBounds: targetBounds,
            message: '没有提供要排列的图层'
        };
    }

    console.log(`[SmartArrange] ========== 开始智能排列 ==========`);
    console.log(`[SmartArrange] 图层数量: ${layerIds.length}`);
    console.log(`[SmartArrange] 目标区域: ${targetBounds.width.toFixed(0)}×${targetBounds.height.toFixed(0)}`);
    console.log(`[SmartArrange] 配置: 间距比例=${config.spacingRatio}, 垂直偏移=${config.verticalOffsetPercent}%`);

    try {
        let appliedScale = 100;
        let finalBounds: BoundingBox = { ...targetBounds };

        await core.executeAsModal(async () => {
            const doc = app.activeDocument;
            if (!doc) throw new Error('没有打开的文档');

            // 1. 获取所有图层的引用和边界
            interface LayerInfo {
                id: number;
                layer: any;
                bounds: BoundingBox;
            }
            const layerInfos: LayerInfo[] = [];

            for (const layerId of layerIds) {
                const layer = findLayerById(doc.layers, layerId);
                if (!layer) {
                    console.warn(`[SmartArrange] 未找到图层 ID: ${layerId}`);
                    continue;
                }
                const bounds = await getContentBounds(layer);
                if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
                    console.warn(`[SmartArrange] 图层 ${layer.name} (ID: ${layerId}) 边界无效`);
                    continue;
                }
                layerInfos.push({ id: layerId, layer, bounds });
            }

            if (layerInfos.length === 0) {
                throw new Error('没有有效的图层可排列');
            }

            console.log(`[SmartArrange] 有效图层: ${layerInfos.length} 个`);

            // 2. 计算参考宽度（使用第一个图层的宽度）
            const referenceWidth = layerInfos[0].bounds.width;
            const spacing = referenceWidth * config.spacingRatio;
            console.log(`[SmartArrange] 参考宽度: ${referenceWidth.toFixed(0)}px, 间距: ${spacing.toFixed(0)}px`);

            // 3. 计算排列位置（先排列到原位，计算总宽度）
            // 起始位置从第一个图层的中心开始
            let currentCenterX = layerInfos[0].bounds.left + layerInfos[0].bounds.width / 2;
            const targetCenterY = doc.height / 2;  // 先居中，后面统一调整

            // 计算并移动每个图层
            for (let i = 0; i < layerInfos.length; i++) {
                const info = layerInfos[i];
                const layerCenterX = info.bounds.left + info.bounds.width / 2;
                const layerCenterY = info.bounds.top + info.bounds.height / 2;

                const offsetX = currentCenterX - layerCenterX;
                const offsetY = targetCenterY - layerCenterY;

                if (Math.abs(offsetX) > 0.5 || Math.abs(offsetY) > 0.5) {
                    info.layer.translate(offsetX, offsetY);
                    console.log(`[SmartArrange] 移动图层 ${info.layer.name}: (${offsetX.toFixed(0)}, ${offsetY.toFixed(0)})`);
                }

                // 更新下一个位置
                currentCenterX += spacing;
            }

            // 4. 多图层编组 → 缩放 → 居中 → 取消编组
            if (layerInfos.length >= 1 && config.autoScale) {
                // 选中所有图层
                await selectMultipleLayers(layerInfos.map(info => info.id));

                // 编组
                const groupId = await groupSelectedLayers();
                if (groupId) {
                    const groupLayer = findLayerById(doc.layers, groupId);
                    if (groupLayer) {
                        // 获取编组边界
                        const groupBounds = await getContentBounds(groupLayer);
                        if (groupBounds && groupBounds.width > 0) {
                            console.log(`[SmartArrange] 编组边界: ${groupBounds.width.toFixed(0)}×${groupBounds.height.toFixed(0)}`);

                            // 计算缩放比例以适应目标区域
                            let scaleX = targetBounds.width / groupBounds.width;
                            let scaleY = targetBounds.height / groupBounds.height;
                            let scale = Math.min(scaleX, scaleY) * 100;

                            // 限制缩放范围
                            scale = Math.max(config.minScale, Math.min(config.maxScale, scale));
                            console.log(`[SmartArrange] 计算缩放: ${scale.toFixed(1)}%`);

                            // 应用缩放
                            if (Math.abs(scale - 100) > 1) {
                                await batchPlayResizeLayer(groupId, scale);
                                appliedScale = scale;
                            }

                            // 刷新边界
                            const scaledBounds = await getContentBounds(groupLayer);
                            if (scaledBounds) {
                                // 计算居中位置
                                const targetCenterX = targetBounds.left + targetBounds.width / 2;
                                const targetCenterY = targetBounds.top + targetBounds.height / 2;
                                const groupCenterX = scaledBounds.left + scaledBounds.width / 2;
                                const groupCenterY = scaledBounds.top + scaledBounds.height / 2;

                                let offsetX = targetCenterX - groupCenterX;
                                let offsetY = targetCenterY - groupCenterY;

                                // 应用垂直偏移（正值下移）
                                const verticalOffset = targetBounds.height * (config.verticalOffsetPercent / 100);
                                offsetY += verticalOffset;

                                // 移动到目标位置
                                if (Math.abs(offsetX) > 0.5 || Math.abs(offsetY) > 0.5) {
                                    await batchPlayTranslateLayer(groupId, offsetX, offsetY);
                                    console.log(`[SmartArrange] 整体移动: (${offsetX.toFixed(0)}, ${offsetY.toFixed(0)})`);
                                }

                                // 更新最终边界
                                const movedBounds = await getContentBounds(groupLayer);
                                if (movedBounds) {
                                    finalBounds = movedBounds;
                                }
                            }
                        }

                        // 取消编组
                        await ungroupLayer(groupId);
                        console.log(`[SmartArrange] 已取消编组`);
                    }
                }
            }

            console.log(`[SmartArrange] ========== 智能排列完成 ==========`);

        }, { commandName: '智能排列图层' });

        return {
            success: true,
            arrangedLayerIds: layerIds,
            appliedScale,
            finalBounds,
            message: `成功排列 ${layerIds.length} 个图层，缩放 ${appliedScale.toFixed(1)}%`
        };

    } catch (error: any) {
        console.error(`[SmartArrange] 排列失败:`, error);
        return {
            success: false,
            arrangedLayerIds: [],
            appliedScale: 100,
            finalBounds: targetBounds,
            message: error.message
        };
    }
}

// ==================== 辅助函数 ====================

/**
 * 根据 ID 查找图层
 */
function findLayerById(layers: any, id: number): any {
    for (const layer of layers) {
        if (layer.id === id) return layer;
        if (layer.layers) {
            const found = findLayerById(layer.layers, id);
            if (found) return found;
        }
    }
    return null;
}

/**
 * 选中多个图层
 */
async function selectMultipleLayers(layerIds: number[]): Promise<void> {
    if (layerIds.length === 0) return;

    // 先选中第一个
    await action.batchPlay([{
        _obj: 'select',
        _target: [{ _ref: 'layer', _id: layerIds[0] }],
        makeVisible: false,
        _options: { dialogOptions: 'dontDisplay' }
    }], { synchronousExecution: true });

    // 添加其他图层到选区
    for (let i = 1; i < layerIds.length; i++) {
        await action.batchPlay([{
            _obj: 'select',
            _target: [{ _ref: 'layer', _id: layerIds[i] }],
            selectionModifier: { _enum: 'selectionModifierType', _value: 'addToSelection' },
            makeVisible: false,
            _options: { dialogOptions: 'dontDisplay' }
        }], { synchronousExecution: true });
    }
}

/**
 * 编组选中的图层
 */
async function groupSelectedLayers(): Promise<number | null> {
    try {
        const doc = app.activeDocument;
        if (!doc) return null;

        await action.batchPlay([{
            _obj: 'make',
            _target: [{ _ref: 'layerSection' }],
            from: { _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' },
            _options: { dialogOptions: 'dontDisplay' }
        }], { synchronousExecution: true });

        // 获取新创建的编组 ID（使用 activeLayers 数组）
        const activeLayers = (doc as any).activeLayers;
        if (activeLayers && activeLayers.length > 0) {
            const activeLayer = activeLayers[0];
            console.log(`[SmartArrange] 创建编组: ${activeLayer.name} (ID: ${activeLayer.id})`);
            return activeLayer.id;
        }
        return null;
    } catch (error: any) {
        console.error(`[SmartArrange] 编组失败:`, error);
        return null;
    }
}

/**
 * 取消编组
 */
async function ungroupLayer(layerId: number): Promise<void> {
    try {
        // 先选中编组
        await action.batchPlay([{
            _obj: 'select',
            _target: [{ _ref: 'layer', _id: layerId }],
            _options: { dialogOptions: 'dontDisplay' }
        }], { synchronousExecution: true });

        // 取消编组
        await action.batchPlay([{
            _obj: 'ungroupLayersEvent',
            _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }],
            _options: { dialogOptions: 'dontDisplay' }
        }], { synchronousExecution: true });
    } catch (error: any) {
        // 静默处理，参考 JSX 脚本
        console.warn(`[SmartArrange] 取消编组时出现警告:`, error.message);
    }
}

/**
 * 使用 batchPlay 缩放图层
 */
async function batchPlayResizeLayer(layerId: number, scalePercent: number): Promise<void> {
    await action.batchPlay([{
        _obj: 'select',
        _target: [{ _ref: 'layer', _id: layerId }],
        _options: { dialogOptions: 'dontDisplay' }
    }], { synchronousExecution: true });

    await action.batchPlay([{
        _obj: 'transform',
        _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }],
        freeTransformCenterState: { _enum: 'quadCenterState', _value: 'QCSAverage' },
        width: { _unit: 'percentUnit', _value: scalePercent },
        height: { _unit: 'percentUnit', _value: scalePercent },
        _options: { dialogOptions: 'dontDisplay' }
    }], { synchronousExecution: true });
}

/**
 * 使用 batchPlay 移动图层
 */
async function batchPlayTranslateLayer(layerId: number, offsetX: number, offsetY: number): Promise<void> {
    await action.batchPlay([{
        _obj: 'select',
        _target: [{ _ref: 'layer', _id: layerId }],
        _options: { dialogOptions: 'dontDisplay' }
    }], { synchronousExecution: true });

    const doc = app.activeDocument;
    const layer = doc ? findLayerById(doc.layers, layerId) : null;
    if (!layer || typeof layer.translate !== 'function') {
        throw new Error(`SmartLayout failed: layer ${layerId} does not support DOM translate; native move is blocked to avoid Photoshop popups.`);
    }
    await Promise.resolve(layer.translate(offsetX, offsetY));
}

// ==================== 工具接口 ====================

import { Tool, ToolResult, ToolSchema } from '../types';

/**
 * 智能布局工具
 */
export class SmartLayoutTool implements Tool {
    name = 'smartLayout';

    schema: ToolSchema = {
        name: 'smartLayout',
        description: '智能布局工具，根据设计规范自动计算合适的尺寸和位置。支持智能排列多个图层组。',
        parameters: {
            type: 'object',
            properties: {
                action: {
                    type: 'string',
                    description: '操作: calculateScale, applyLayout, analyzeLayout, smartArrange（智能排列多个图层）'
                },
                sourceLayerName: {
                    type: 'string',
                    description: '源图层名称'
                },
                targetBounds: {
                    type: 'object',
                    description: '目标区域 {left, top, width, height}。对于 smartArrange，这是排列的目标区域。'
                },
                config: {
                    type: 'object',
                    description: '布局配置 {fillRatio, alignment, ...} 或排列配置 {spacingRatio, verticalOffsetPercent, ...}'
                },
                layerIds: {
                    type: 'array',
                    description: '(smartArrange) 要排列的图层 ID 列表',
                    items: { type: 'number' }
                },
                layerNames: {
                    type: 'array',
                    description: '(smartArrange) 要排列的图层名称列表（如果不提供 layerIds）',
                    items: { type: 'string' }
                }
            },
            required: ['action']
        }
    };

    async execute(params: {
        action: string;
        sourceLayerName?: string;
        targetBounds?: { left: number; top: number; width: number; height: number };
        config?: Record<string, any>;
        layerIds?: number[];
        layerNames?: string[];
    }): Promise<ToolResult<any>> {
        try {
            switch (params.action) {
                case 'calculateScale':
                    return await this.handleCalculateScale({
                        sourceLayerName: params.sourceLayerName,
                        targetBounds: params.targetBounds,
                        config: params.config as Partial<LayoutConfig>
                    });
                case 'applyLayout':
                    return await this.handleApplyLayout({
                        sourceLayerName: params.sourceLayerName,
                        targetBounds: params.targetBounds,
                        config: params.config as Partial<LayoutConfig>
                    });
                case 'analyzeLayout':
                    return await this.handleAnalyzeLayout();
                case 'getRecommendedConfig':
                    return this.getRecommendedConfig();
                case 'smartArrange':
                    return await this.handleSmartArrange({
                        targetBounds: params.targetBounds,
                        config: params.config as Partial<SmartArrangeConfig>,
                        layerIds: params.layerIds,
                        layerNames: params.layerNames
                    });
                default:
                    return { success: false, error: `未知操作: ${params.action}`, data: null };
            }
        } catch (error: any) {
            return { success: false, error: error.message, data: null };
        }
    }

    /**
     * 处理智能排列操作
     * 
     * 核心功能：在用户指定的区域内自动排列多个图层组
     * 不需要精确的占位矩形，只需一个大致区域
     */
    private async handleSmartArrange(params: {
        targetBounds?: { left: number; top: number; width: number; height: number };
        config?: Partial<SmartArrangeConfig>;
        layerIds?: number[];
        layerNames?: string[];
    }): Promise<ToolResult<any>> {
        const doc = app.activeDocument;
        if (!doc) {
            return { success: false, error: '没有打开的文档', data: null };
        }

        // 获取要排列的图层 ID
        let layerIds: number[] = params.layerIds || [];

        // 如果提供了名称而非 ID，转换为 ID
        if (layerIds.length === 0 && params.layerNames && params.layerNames.length > 0) {
            for (const name of params.layerNames) {
                const layer = this.findLayerByName((doc as any).layers, name);
                if (layer) {
                    layerIds.push(layer.id);
                } else {
                    console.warn(`[SmartLayout] 未找到图层: ${name}`);
                }
            }
        }

        // 如果都没有，使用当前文档中的所有顶级图层组
        if (layerIds.length === 0) {
            console.log(`[SmartLayout] 未指定图层，自动检测顶级图层组...`);
            for (const layer of (doc as any).layers) {
                // 图层组有 layers 属性
                if (layer.layers && layer.layers.length > 0) {
                    layerIds.push(layer.id);
                    console.log(`[SmartLayout]   发现图层组: ${layer.name} (ID: ${layer.id})`);
                }
            }
        }

        if (layerIds.length === 0) {
            return { success: false, error: '没有找到可排列的图层组', data: null };
        }

        // 获取目标边界
        let targetBounds: BoundingBox;
        if (params.targetBounds) {
            targetBounds = {
                left: params.targetBounds.left,
                top: params.targetBounds.top,
                right: params.targetBounds.left + params.targetBounds.width,
                bottom: params.targetBounds.top + params.targetBounds.height,
                width: params.targetBounds.width,
                height: params.targetBounds.height
            };
        } else {
            // 尝试查找占位矩形（名称包含"占位"或"placeholder"或是普通矩形图层）
            let placeholderBounds = await this.findPlaceholderBounds(doc);
            if (placeholderBounds) {
                targetBounds = placeholderBounds;
                console.log(`[SmartLayout] 使用检测到的占位矩形: ${targetBounds.width.toFixed(0)}×${targetBounds.height.toFixed(0)}`);
            } else {
                // 使用画布（留 5% 边距）
                const margin = Math.min(doc.width, doc.height) * 0.05;
                targetBounds = {
                    left: margin,
                    top: margin,
                    right: doc.width - margin,
                    bottom: doc.height - margin,
                    width: doc.width - 2 * margin,
                    height: doc.height - 2 * margin
                };
                console.log(`[SmartLayout] 使用画布作为目标区域（留 5% 边距）`);
            }
        }

        // 合并配置
        const arrangeConfig: SmartArrangeConfig = {
            ...DEFAULT_ARRANGE_CONFIG,
            ...(params.config as Partial<SmartArrangeConfig>)
        };

        // 执行智能排列
        const result = await smartArrangeLayerGroups(layerIds, targetBounds, arrangeConfig);

        return {
            success: result.success,
            error: result.success ? undefined : result.message,
            data: {
                message: result.message,
                arrangedCount: result.arrangedLayerIds.length,
                layerIds: result.arrangedLayerIds,
                appliedScale: result.appliedScale,
                finalBounds: {
                    left: result.finalBounds.left,
                    top: result.finalBounds.top,
                    width: result.finalBounds.width,
                    height: result.finalBounds.height
                }
            }
        };
    }

    /**
     * 查找占位矩形的边界
     * 优先查找名称包含"占位"的图层
     */
    private async findPlaceholderBounds(doc: any): Promise<BoundingBox | null> {
        const layers = doc.layers || [];
        
        for (const layer of layers) {
            // 跳过图层组
            if (layer.layers && layer.layers.length > 0) continue;
            
            const name = (layer.name || '').toLowerCase();
            // 查找占位符命名
            if (name.includes('占位') || name.includes('placeholder') || name.includes('区域') || name.includes('area')) {
                const bounds = await getContentBounds(layer);
                if (bounds && bounds.width > 0 && bounds.height > 0) {
                    console.log(`[SmartLayout] 找到占位图层: ${layer.name}`);
                    return bounds;
                }
            }
        }

        // 如果没有找到命名占位符，查找第一个普通图层（假设是占位矩形）
        for (const layer of layers) {
            if (layer.layers && layer.layers.length > 0) continue;
            const bounds = await getContentBounds(layer);
            if (bounds && bounds.width > 100 && bounds.height > 100) {
                console.log(`[SmartLayout] 使用普通图层作为占位: ${layer.name}`);
                return bounds;
            }
        }

        return null;
    }

    private async handleCalculateScale(params: {
        sourceLayerName?: string;
        targetBounds?: { left: number; top: number; width: number; height: number };
        config?: Partial<LayoutConfig>;
    }): Promise<ToolResult<any>> {
        const doc = app.activeDocument;
        if (!doc) {
            return { success: false, error: '没有打开的文档', data: null };
        }

        // 获取源图层
        let sourceLayer: any = null;
        if (params.sourceLayerName) {
            sourceLayer = this.findLayerByName((doc as any).layers, params.sourceLayerName);
        } else {
            sourceLayer = (doc as any).activeLayer;
        }

        if (!sourceLayer) {
            return { success: false, error: '未找到源图层', data: null };
        }

        // 获取源边界
        const sourceBounds = await getContentBounds(sourceLayer);
        if (!sourceBounds) {
            return { success: false, error: '无法获取图层边界', data: null };
        }

        // 获取目标边界
        let targetBounds: BoundingBox;
        if (params.targetBounds) {
            targetBounds = {
                left: params.targetBounds.left,
                top: params.targetBounds.top,
                right: params.targetBounds.left + params.targetBounds.width,
                bottom: params.targetBounds.top + params.targetBounds.height,
                width: params.targetBounds.width,
                height: params.targetBounds.height
            };
        } else {
            // 使用画布作为目标
            targetBounds = {
                left: 0,
                top: 0,
                right: doc.width,
                bottom: doc.height,
                width: doc.width,
                height: doc.height
            };
        }

        // 合并配置
        const config: LayoutConfig = {
            ...DEFAULT_ECOMMERCE_CONFIG,
            ...params.config
        };

        // 计算缩放
        const result = calculateSmartScale(sourceBounds, targetBounds, config);

        return {
            success: true,
            data: {
                ...result,
                // 附加调试信息
                debug: {
                    sourceBounds,
                    targetBounds,
                    config
                }
            }
        };
    }

    private async handleApplyLayout(params: {
        sourceLayerName?: string;
        targetBounds?: { left: number; top: number; width: number; height: number };
        config?: Partial<LayoutConfig>;
    }): Promise<ToolResult<any>> {
        // 先计算
        const calcResult = await this.handleCalculateScale(params);
        if (!calcResult.success || !calcResult.data) {
            return calcResult;
        }

        const doc = app.activeDocument;
        if (!doc) {
            return { success: false, error: '没有打开的文档', data: null };
        }
        
        let sourceLayer: any = null;
        if (params.sourceLayerName) {
            sourceLayer = this.findLayerByName((doc as any).layers, params.sourceLayerName);
        } else {
            sourceLayer = (doc as any).activeLayer;
        }

        // 应用
        const applyResult = await applySmartScale(sourceLayer, calcResult.data);
        
        if (applyResult.success) {
            return {
                success: true,
                data: {
                    message: '智能布局完成',
                    scale: calcResult.data.scale,
                    position: calcResult.data.targetPosition,
                    warnings: calcResult.data.warnings
                }
            };
        } else {
            return { success: false, error: applyResult.error, data: null };
        }
    }

    private async handleAnalyzeLayout(): Promise<ToolResult<any>> {
        const doc = app.activeDocument;
        if (!doc) {
            return { success: false, error: '没有打开的文档', data: null };
        }

        const canvas = {
            width: doc.width,
            height: doc.height,
            aspectRatio: doc.width / doc.height
        };

        // 分析所有可见图层
        const layers: any[] = [];
        const collectLayers = (container: any) => {
            for (const layer of container.layers) {
                if (layer.visible) {
                    const bounds = layer.bounds;
                    if (bounds) {
                        const width = (bounds.right ?? bounds[2]) - (bounds.left ?? bounds[0]);
                        const height = (bounds.bottom ?? bounds[3]) - (bounds.top ?? bounds[1]);
                        const fillRatio = (width * height) / (canvas.width * canvas.height);
                        
                        layers.push({
                            name: layer.name,
                            bounds: { 
                                left: bounds.left ?? bounds[0],
                                top: bounds.top ?? bounds[1],
                                width,
                                height
                            },
                            fillRatio: (fillRatio * 100).toFixed(1) + '%',
                            isProperSize: fillRatio >= 0.1 && fillRatio <= 0.8,
                            suggestion: fillRatio < 0.1 
                                ? '素材太小，建议放大' 
                                : fillRatio > 0.8 
                                    ? '素材太大，建议缩小' 
                                    : '尺寸合适'
                        });
                    }
                }
                if (layer.layers) {
                    collectLayers(layer);
                }
            }
        };
        collectLayers(doc);

        return {
            success: true,
            data: {
                canvas,
                layers,
                recommendations: {
                    idealFillRatio: '65%-85%',
                    safeMargin: `${canvas.width * 0.05}px`,
                    mainSubjectArea: `${Math.round(canvas.width * 0.75)}×${Math.round(canvas.height * 0.75)}px`
                }
            }
        };
    }

    private getRecommendedConfig(): ToolResult<any> {
        return {
            success: true,
            data: {
                presets: {
                    ecommerce: DEFAULT_ECOMMERCE_CONFIG,
                    skuCombo: SKU_COMBO_CONFIG,
                    // 更多预设
                    hero: {
                        ...DEFAULT_ECOMMERCE_CONFIG,
                        fillRatio: 0.90,
                        maxFillRatio: 0.95,
                        alignment: 'center'
                    },
                    thumbnail: {
                        ...DEFAULT_ECOMMERCE_CONFIG,
                        fillRatio: 0.85,
                        alignment: 'center'
                    }
                },
                explanation: {
                    fillRatio: '主体占目标区域的比例，0.75 表示 75%',
                    safeMarginRatio: '安全边距比例，0.05 表示 5%',
                    alignment: '对齐方式：center/top/bottom/left/right/visual-center'
                }
            }
        };
    }

    private findLayerByName(layers: any, name: string): any {
        for (const layer of layers) {
            if (layer.name === name) {
                return layer;
            }
            if (layer.layers) {
                const found = this.findLayerByName(layer.layers, name);
                if (found) return found;
            }
        }
        return null;
    }
}

export default SmartLayoutTool;
