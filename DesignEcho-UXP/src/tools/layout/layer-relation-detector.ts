/**
 * 图层关系检测器
 * @description 检测 Photoshop 图层结构中的问题 (遮挡、剪切蒙版断裂、溢出等)
 */

import { app, action } from 'photoshop';

// ==================== 类型定义 ====================

interface BoundingBox {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
}

type LayerIssueType = 
    | 'occlusion'
    | 'clipping_broken'
    | 'overflow'
    | 'hidden_content'
    | 'aspect_distortion'
    | 'effect_clipped'
    | 'empty_placeholder'
    | 'invalid_structure';

interface LayerIssue {
    type: LayerIssueType;
    severity: 'critical' | 'warning' | 'info';
    layerId: number;
    layerName: string;
    screenIndex?: number;
    description: string;
    autoFixable: boolean;
    suggestedFix?: string;
    fixParams?: Record<string, any>;
}

interface CopyPlaceholder {
    layerId: number;
    layerName: string;
    currentText: string;
    bounds: BoundingBox;
    role: string;
    fontSize: number;
    maxWidth?: number;
}

interface ImagePlaceholder {
    layerId: number;
    layerName: string;
    bounds: BoundingBox;
    isClippingMask: boolean;
    aspectRatio: number;
}

interface ParsedScreen {
    id: number;
    name: string;
    index: number;
    copyPlaceholders: CopyPlaceholder[];
    imagePlaceholders: ImagePlaceholder[];
}

// ==================== 检测器类 ====================

export class LayerRelationDetector {
    
    /**
     * 检测指定屏的所有图层问题
     */
    async detectIssues(screen: ParsedScreen): Promise<LayerIssue[]> {
        const issues: LayerIssue[] = [];
        const doc = app.activeDocument;
        
        if (!doc) {
            return issues;
        }
        
        const screenGroup = this.findLayerById(doc.layers, screen.id);
        if (!screenGroup) {
            console.warn(`[LayerRelationDetector] 找不到屏 ${screen.name}`);
            return issues;
        }
        
        console.log(`[LayerRelationDetector] 检测屏: ${screen.name}`);
        
        // 1. 检测剪切蒙版问题
        const clippingIssues = await this.detectClippingIssues(screenGroup, screen.index);
        issues.push(...clippingIssues);
        
        // 2. 检测文字溢出
        for (const copy of screen.copyPlaceholders) {
            const overflow = await this.detectTextOverflow(copy, screen.index);
            if (overflow) issues.push(overflow);
        }
        
        // 3. 检测图层遮挡
        const occlusionIssues = await this.detectOcclusion(screenGroup, screen.index);
        issues.push(...occlusionIssues);
        
        // 4. 检测图片变形
        for (const img of screen.imagePlaceholders) {
            const distortion = await this.detectAspectDistortion(img, screen.index);
            if (distortion) issues.push(distortion);
        }
        
        // 5. 检测空占位符
        const emptyIssues = await this.detectEmptyPlaceholders(screenGroup, screen.index);
        issues.push(...emptyIssues);
        
        console.log(`[LayerRelationDetector] 屏 ${screen.name} 发现 ${issues.length} 个问题`);
        
        return issues;
    }
    
    /**
     * 检测所有屏的问题
     */
    async detectAllIssues(screens: ParsedScreen[]): Promise<LayerIssue[]> {
        const allIssues: LayerIssue[] = [];
        
        for (const screen of screens) {
            const issues = await this.detectIssues(screen);
            allIssues.push(...issues);
        }
        
        return allIssues;
    }
    
    /**
     * 检测剪切蒙版断裂
     */
    private async detectClippingIssues(group: any, screenIndex: number): Promise<LayerIssue[]> {
        const issues: LayerIssue[] = [];
        
        const checkLayers = (layers: any[], parentPath: string = '') => {
            for (let i = 0; i < layers.length; i++) {
                const layer = layers[i];
                const layerPath = parentPath ? `${parentPath} > ${layer.name}` : layer.name;
                
                // 检查剪切蒙版完整性
                if (layer.clipped) {
                    // 查找基底图层 (应该在下一个位置)
                    let hasValidBase = false;
                    for (let j = i + 1; j < layers.length; j++) {
                        if (!layers[j].clipped) {
                            hasValidBase = true;
                            break;
                        }
                    }
                    
                    if (!hasValidBase) {
                        issues.push({
                            type: 'clipping_broken',
                            severity: 'critical',
                            layerId: layer.id,
                            layerName: layer.name,
                            screenIndex,
                            description: `剪切蒙版 "${layer.name}" 找不到基底图层`,
                            autoFixable: false,
                            suggestedFix: '手动检查剪切蒙版关系'
                        });
                    }
                }
                
                // 检查应该有剪切蒙版但没有的情况
                if (this.shouldBeClipped(layer) && !layer.clipped) {
                    // 检查上一个图层是否是基底候选
                    const prevLayer = i > 0 ? layers[i - 1] : null;
                    if (prevLayer && !prevLayer.clipped && this.couldBeBase(prevLayer)) {
                        issues.push({
                            type: 'clipping_broken',
                            severity: 'warning',
                            layerId: layer.id,
                            layerName: layer.name,
                            screenIndex,
                            description: `图层 "${layer.name}" 可能需要剪切蒙版`,
                            autoFixable: true,
                            suggestedFix: '建立剪切蒙版',
                            fixParams: { baseLayerId: prevLayer.id }
                        });
                    }
                }
                
                // 递归检查子组
                if (layer.kind === 'group' && layer.layers) {
                    checkLayers(layer.layers, layerPath);
                }
            }
        };
        
        if (group.layers) {
            checkLayers(group.layers);
        }
        
        return issues;
    }
    
    /**
     * 检测文字溢出
     */
    private async detectTextOverflow(copy: CopyPlaceholder, screenIndex: number): Promise<LayerIssue | null> {
        const doc = app.activeDocument;
        if (!doc) return null;
        
        const layer = this.findLayerById(doc.layers, copy.layerId);
        if (!layer || layer.kind !== 'text') return null;
        
        try {
            const bounds = layer.bounds;
            const actualWidth = bounds.right - bounds.left;
            
            // 如果实际宽度超过容器宽度 10% 以上
            if (copy.maxWidth && actualWidth > copy.maxWidth * 1.1) {
                return {
                    type: 'overflow',
                    severity: 'warning',
                    layerId: copy.layerId,
                    layerName: copy.layerName,
                    screenIndex,
                    description: `文字 "${copy.layerName}" 超出容器边界 (${Math.round(actualWidth)}px > ${Math.round(copy.maxWidth)}px)`,
                    autoFixable: true,
                    suggestedFix: '缩小字号或调整文本',
                    fixParams: {
                        currentWidth: actualWidth,
                        maxWidth: copy.maxWidth,
                        overflowRatio: actualWidth / copy.maxWidth
                    }
                };
            }
        } catch (e) {
            console.warn(`[LayerRelationDetector] 检测文字溢出失败: ${copy.layerName}`, e);
        }
        
        return null;
    }
    
    /**
     * 检测图层遮挡
     */
    private async detectOcclusion(group: any, screenIndex: number): Promise<LayerIssue[]> {
        const issues: LayerIssue[] = [];
        
        if (!group.layers) return issues;
        
        const layers = group.layers.filter((l: any) => l.visible);
        
        for (let i = 0; i < layers.length; i++) {
            for (let j = i + 1; j < layers.length; j++) {
                const upperLayer = layers[i];  // 上层 (图层面板中靠上)
                const lowerLayer = layers[j];  // 下层
                
                // 跳过剪切蒙版关系
                if (upperLayer.clipped || lowerLayer.clipped) continue;
                
                // 跳过图层组
                if (upperLayer.kind === 'group' || lowerLayer.kind === 'group') continue;
                
                try {
                    // 检查是否重叠
                    if (this.boundsOverlap(upperLayer.bounds, lowerLayer.bounds)) {
                        // 如果上层是不透明的且完全覆盖下层
                        if (upperLayer.opacity === 100 && 
                            this.fullyCovers(upperLayer.bounds, lowerLayer.bounds)) {
                            issues.push({
                                type: 'occlusion',
                                severity: 'warning',
                                layerId: lowerLayer.id,
                                layerName: lowerLayer.name,
                                screenIndex,
                                description: `图层 "${lowerLayer.name}" 被 "${upperLayer.name}" 完全遮挡`,
                                autoFixable: true,
                                suggestedFix: '调整图层顺序或降低透明度',
                                fixParams: {
                                    occludingLayerId: upperLayer.id,
                                    occludingLayerName: upperLayer.name
                                }
                            });
                        }
                    }
                } catch (e) {
                    // 忽略获取 bounds 失败的情况
                }
            }
        }
        
        return issues;
    }
    
    /**
     * 检测图片宽高比变形
     */
    private async detectAspectDistortion(img: ImagePlaceholder, screenIndex: number): Promise<LayerIssue | null> {
        const doc = app.activeDocument;
        if (!doc) return null;
        
        const layer = this.findLayerById(doc.layers, img.layerId);
        if (!layer) return null;
        
        try {
            // 获取原始宽高比 (通过 batchPlay)
            const originalRatio = await this.getOriginalAspectRatio(layer.id);
            if (!originalRatio) return null;
            
            const currentBounds = layer.bounds;
            const currentRatio = (currentBounds.right - currentBounds.left) / 
                                (currentBounds.bottom - currentBounds.top);
            
            // 允许 5% 误差
            if (Math.abs(currentRatio - originalRatio) / originalRatio > 0.05) {
                return {
                    type: 'aspect_distortion',
                    severity: 'warning',
                    layerId: img.layerId,
                    layerName: img.layerName,
                    screenIndex,
                    description: `图片 "${img.layerName}" 宽高比变形 (${currentRatio.toFixed(2)} vs ${originalRatio.toFixed(2)})`,
                    autoFixable: true,
                    suggestedFix: '恢复原始宽高比',
                    fixParams: {
                        originalRatio,
                        currentRatio
                    }
                };
            }
        } catch (e) {
            console.warn(`[LayerRelationDetector] 检测宽高比失败: ${img.layerName}`, e);
        }
        
        return null;
    }
    
    /**
     * 检测空占位符
     */
    private async detectEmptyPlaceholders(group: any, screenIndex: number): Promise<LayerIssue[]> {
        const issues: LayerIssue[] = [];
        
        const checkLayers = (layers: any[]) => {
            for (const layer of layers) {
                // 检查空文本图层
                if (layer.kind === 'text') {
                    try {
                        const text = layer.textItem?.contents || '';
                        if (!text.trim() || text.includes('占位') || text.includes('placeholder')) {
                            issues.push({
                                type: 'empty_placeholder',
                                severity: 'info',
                                layerId: layer.id,
                                layerName: layer.name,
                                screenIndex,
                                description: `文案占位符 "${layer.name}" 需要填充内容`,
                                autoFixable: false,
                                suggestedFix: '填充文案内容'
                            });
                        }
                    } catch {
                        // 忽略
                    }
                }
                
                // 递归检查子组
                if (layer.kind === 'group' && layer.layers) {
                    checkLayers(layer.layers);
                }
            }
        };
        
        if (group.layers) {
            checkLayers(group.layers);
        }
        
        return issues;
    }
    
    // ==================== 工具方法 ====================
    
    private boundsOverlap(a: any, b: any): boolean {
        return !(a.right < b.left || a.left > b.right || 
                 a.bottom < b.top || a.top > b.bottom);
    }
    
    private fullyCovers(outer: any, inner: any): boolean {
        return outer.left <= inner.left && outer.right >= inner.right &&
               outer.top <= inner.top && outer.bottom >= inner.bottom;
    }
    
    private findLayerById(layers: any, id: number): any {
        if (!layers) return null;
        
        const layerArray = Array.isArray(layers) ? layers : [layers];
        
        for (const layer of layerArray) {
            if (layer.id === id) return layer;
            if (layer.layers) {
                const found = this.findLayerById(layer.layers, id);
                if (found) return found;
            }
        }
        return null;
    }
    
    private shouldBeClipped(layer: any): boolean {
        const name = (layer.name || '').toLowerCase();
        return name.includes('图片') || name.includes('image') || 
               name.includes('photo') || name.includes('img') ||
               name.includes('产品') || name.includes('模特');
    }
    
    private couldBeBase(layer: any): boolean {
        // 矩形或形状图层可能是剪切蒙版基底
        return layer.kind === 'shapeLayer' || layer.kind === 'vector' ||
               (layer.name || '').toLowerCase().includes('矩形') ||
               (layer.name || '').toLowerCase().includes('rect');
    }
    
    private async getOriginalAspectRatio(layerId: number): Promise<number | null> {
        try {
            const result = await action.batchPlay([{
                _obj: 'get',
                _target: [{ _ref: 'layer', _id: layerId }],
                _options: { dialogOptions: 'dontDisplay' }
            }], { synchronousExecution: true });
            
            const smartObject = result[0]?.smartObject;
            if (smartObject && smartObject.size) {
                return smartObject.size.width / smartObject.size.height;
            }
            return null;
        } catch {
            return null;
        }
    }
}

// ==================== 工具类 ====================

export class LayerRelationDetectorTool {
    name = 'detectLayerIssues';
    
    schema = {
        name: 'detectLayerIssues',
        description: '检测详情页图层结构问题 (遮挡、剪切蒙版、溢出等)',
        parameters: {
            type: 'object' as const,
            properties: {
                screenId: {
                    type: 'number',
                    description: '要检测的屏 ID (可选，不传检测所有屏)'
                },
                screens: {
                    type: 'array',
                    description: '要检测的屏列表'
                }
            },
            required: [] as string[]
        }
    };
    
    async execute(params: { screenId?: number; screens?: ParsedScreen[] }): Promise<LayerIssue[]> {
        const detector = new LayerRelationDetector();
        
        if (params.screens) {
            if (params.screenId !== undefined) {
                const screen = params.screens.find(s => s.id === params.screenId);
                if (screen) {
                    return await detector.detectIssues(screen);
                }
                return [];
            }
            return await detector.detectAllIssues(params.screens);
        }
        
        return [];
    }
}
