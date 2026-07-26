/**
 * 视觉分析工具
 * 
 * 获取画布快照、分析元素位置、建立图层与视觉元素的映射
 */

import { Tool, ToolSchema } from '../types';
import { observeActiveDocumentAtHistoryState } from '../../core/photoshop-document-observation';
import type { PhotoshopHistoryStateRef } from '../../core/photoshop-history-state-ref';
import {
    encodePhotoshopImageDataAsJpeg,
    toSnapshotErrorMessage
} from './snapshot-encoding';

const app = require('photoshop').app;
const { imaging } = require('photoshop');

/**
 * 获取画布快照工具
 * 
 * 获取当前文档的视觉快照，用于 AI 分析画面内容
 */
export class GetCanvasSnapshotTool implements Tool {
    name = 'getCanvasSnapshot';

    schema: ToolSchema = {
        name: 'getCanvasSnapshot',
        description: '获取当前画布的视觉快照（截图）。用于让 AI 理解画面中的视觉内容、布局和元素。返回 Base64 编码的图片。适用场景：分析设计布局、识别画面元素、理解视觉结构。',
        parameters: {
            type: 'object',
            properties: {
                maxSize: {
                    type: 'number',
                    description: '最大尺寸（像素），图片会按比例缩放到此尺寸内。默认 1024，建议不超过 2048。'
                },
                format: {
                    type: 'string',
                    enum: ['jpeg', 'png'],
                    description: '兼容请求格式；当前快照统一返回 JPEG'
                },
                quality: {
                    type: 'number',
                    description: '兼容字段；当前由 Photoshop Imaging API 统一编码'
                },
                region: {
                    type: 'object',
                    description: '只截取文档中的一个区域（文档像素坐标 {x,y,width,height}）。长文档（如详情页）观察某一屏时必用：全图缩放会小到看不清',
                    properties: {
                        x: { type: 'number', description: '区域左上角 X 坐标（文档像素）' },
                        y: { type: 'number', description: '区域左上角 Y 坐标（文档像素）' },
                        width: { type: 'number', description: '区域宽度（文档像素）' },
                        height: { type: 'number', description: '区域高度（文档像素）' }
                    }
                }
            }
        }
    };

    async execute(params: {
        maxSize?: number;
        format?: string;
        quality?: number;
        region?: { x?: number; y?: number; width?: number; height?: number };
    }): Promise<{
        success: boolean;
        snapshot?: {
            base64: string;
            width: number;
            height: number;
            format: string;
        };
        requestedFormat?: string;
        message?: string;
        region?: { x: number; y: number; width: number; height: number };
        historyStateRef?: PhotoshopHistoryStateRef;
        documentInfo?: {
            id: number;
            name: string;
            width: number;
            height: number;
            layerCount: number;
        };
        error?: string;
    }> {
        try {
            const maxSize = params.maxSize || 1024;
            const requestedFormat = params.format || 'jpeg';
            const outputFormat = 'jpeg';
            const observation = await observeActiveDocumentAtHistoryState({
                commandName: 'DesignEcho: 获取画布快照',
                timeOut: 5,
                unavailableMessage: '无法读取 Photoshop 文档历史版本，未返回可能过期的画布快照。',
                changedMessage: '截图期间 Photoshop 文档发生变化，已丢弃这张不一致的画布快照。'
            }, async (doc) => {
                const documentWidth = Number(doc.width);
                const documentHeight = Number(doc.height);
                let regionRect: { x: number; y: number; width: number; height: number } | null = null;
                if (params.region && Number(params.region.width) > 0 && Number(params.region.height) > 0) {
                    const rx = Math.max(0, Math.min(documentWidth - 1, Math.round(Number(params.region.x) || 0)));
                    const ry = Math.max(0, Math.min(documentHeight - 1, Math.round(Number(params.region.y) || 0)));
                    const rw = Math.min(documentWidth - rx, Math.round(Number(params.region.width)));
                    const rh = Math.min(documentHeight - ry, Math.round(Number(params.region.height)));
                    if (rw > 0 && rh > 0) {
                        regionRect = { x: rx, y: ry, width: rw, height: rh };
                    }
                }

                let targetWidth = regionRect ? regionRect.width : documentWidth;
                let targetHeight = regionRect ? regionRect.height : documentHeight;
                if (targetWidth > maxSize || targetHeight > maxSize) {
                    const scale = Math.min(maxSize / targetWidth, maxSize / targetHeight);
                    targetWidth = Math.max(1, Math.round(targetWidth * scale));
                    targetHeight = Math.max(1, Math.round(targetHeight * scale));
                }

                let pixelData: any;
                let encoded;
                try {
                    pixelData = await imaging.getPixels({
                        documentID: doc.id,
                        ...(regionRect ? {
                            sourceBounds: {
                                left: regionRect.x,
                                top: regionRect.y,
                                right: regionRect.x + regionRect.width,
                                bottom: regionRect.y + regionRect.height
                            }
                        } : {}),
                        targetSize: { width: targetWidth, height: targetHeight },
                        colorSpace: 'RGB',
                        componentSize: 8,
                        applyAlpha: true,
                    });
                    encoded = await encodePhotoshopImageDataAsJpeg(
                        pixelData.imageData,
                        targetWidth,
                        targetHeight
                    );
                } catch (imagingError) {
                    if (regionRect) {
                        // 区域模式不降级全图：返回全图会让模型误以为看到的是区域，比失败更糟
                        throw new Error(`区域截图失败（region ${regionRect.x},${regionRect.y} ${regionRect.width}x${regionRect.height}）：${imagingError instanceof Error ? imagingError.message : String(imagingError)}。可尝试缩小区域或用不带 region 的快照。`);
                    }
                    // 大文档全图失败要指路 region（失败信息不指路=模型只能反复裸调，真机病例）
                    if (Number(doc.height) > 8000 || Number(doc.width) > 8000) {
                        throw new Error(`全图截取失败：文档 ${doc.width}x${doc.height}px 过大。请带 region 参数只看目标区域，例如 {x:0, y:目标屏起点, width:${doc.width}, height:屏高}；目标图层的区域可先用 getLayerBounds/findLayers 读到。`);
                    }
                    throw imagingError;
                } finally {
                    pixelData?.imageData?.dispose?.();
                }

                let layerCount = 0;
                const countLayers = (container: any): void => {
                    for (const layer of container.layers) {
                        layerCount += 1;
                        if (layer.layers) countLayers(layer);
                    }
                };
                countLayers(doc);
                return {
                    snapshot: {
                        base64: encoded.base64,
                        width: encoded.width,
                        height: encoded.height,
                        format: outputFormat
                    },
                    regionRect,
                    documentInfo: {
                        id: Number(doc.id),
                        name: String(doc.name || ''),
                        width: documentWidth,
                        height: documentHeight,
                        layerCount
                    }
                };
            });

            return {
                success: true,
                snapshot: observation.value.snapshot,
                requestedFormat,
                message: requestedFormat === outputFormat
                    ? undefined
                    : '已返回可预览快照，格式为 JPEG。',
                ...(observation.value.regionRect ? { region: observation.value.regionRect } : {}),
                historyStateRef: observation.historyStateRef,
                documentInfo: observation.value.documentInfo
            };

        } catch (error) {
            console.error('[GetCanvasSnapshot] Error:', error);
            return {
                success: false,
                error: toSnapshotErrorMessage(error)
            };
        }
    }
}

/**
 * 获取元素映射工具
 * 
 * 分析所有图层并返回其视觉位置和属性
 */
export class GetElementMappingTool implements Tool {
    name = 'getElementMapping';

    schema: ToolSchema = {
        name: 'getElementMapping',
        description: '获取所有图层的详细视觉信息，包括位置、大小、类型、内容等。用于建立"画面中看到的元素"与"图层"之间的映射关系。这是理解设计结构的核心工具。',
        parameters: {
            type: 'object',
            properties: {
                includeHidden: {
                    type: 'boolean',
                    description: '是否包含隐藏图层，默认 false'
                },
                includeGroups: {
                    type: 'boolean',
                    description: '是否包含图层组，默认 true'
                },
                sortBy: {
                    type: 'string',
                    enum: ['position', 'size', 'name', 'type'],
                    description: '排序方式，默认按位置（从上到下、从左到右）'
                }
            }
        }
    };

    async execute(params: {
        includeHidden?: boolean;
        includeGroups?: boolean;
        sortBy?: string;
    }): Promise<{
        success: boolean;
        elements?: Array<{
            id: number;
            name: string;
            type: string;
            visible: boolean;
            bounds: {
                left: number;
                top: number;
                right: number;
                bottom: number;
                width: number;
                height: number;
                centerX: number;
                centerY: number;
            };
            position: string;  // 位置描述（如"左上角"、"中间"等）
            textContent?: string;  // 如果是文本图层
            opacity: number;
            blendMode: string;
            isClipped: boolean;
            parentGroup?: string;
        }>;
        summary?: {
            totalElements: number;
            textLayers: number;
            imageLayers: number;
            shapeLayers: number;
            groups: number;
        };
        error?: string;
    }> {
        try {
            const doc = app.activeDocument;
            if (!doc) {
                return { success: false, error: '没有打开的文档' };
            }

            const includeHidden = params.includeHidden === true;
            const includeGroups = params.includeGroups !== false;
            const sortBy = params.sortBy || 'position';

            const elements: any[] = [];
            const docWidth = doc.width;
            const docHeight = doc.height;

            // 递归收集所有图层信息
            const collectLayers = (container: any, parentName?: string) => {
                for (const layer of container.layers) {
                    // 跳过隐藏图层
                    if (!includeHidden && !layer.visible) continue;

                    const isGroup = layer.layers && layer.layers.length > 0;
                    
                    // 如果不包含组，跳过
                    if (!includeGroups && isGroup) {
                        // 但仍要递归处理组内图层
                        collectLayers(layer, layer.name);
                        continue;
                    }

                    // 获取边界
                    let bounds = { left: 0, top: 0, right: 0, bottom: 0 };
                    try {
                        bounds = layer.bounds;
                    } catch {}

                    const width = bounds.right - bounds.left;
                    const height = bounds.bottom - bounds.top;
                    const centerX = bounds.left + width / 2;
                    const centerY = bounds.top + height / 2;

                    // 计算位置描述
                    const position = this.describePosition(centerX, centerY, docWidth, docHeight);

                    // 获取图层类型
                    const type = this.getLayerType(layer);

                    // 获取文本内容（如果是文本图层）
                    let textContent: string | undefined;
                    if (type === 'text') {
                        try {
                            textContent = (layer as any).textItem?.contents || '';
                        } catch {}
                    }

                    elements.push({
                        id: layer.id,
                        name: layer.name,
                        type,
                        visible: layer.visible,
                        bounds: {
                            left: bounds.left,
                            top: bounds.top,
                            right: bounds.right,
                            bottom: bounds.bottom,
                            width,
                            height,
                            centerX,
                            centerY
                        },
                        position,
                        textContent,
                        opacity: layer.opacity,
                        blendMode: layer.blendMode?.toString() || 'normal',
                        isClipped: layer.isClippingMask || false,
                        parentGroup: parentName
                    });

                    // 递归处理子图层
                    if (isGroup) {
                        collectLayers(layer, layer.name);
                    }
                }
            };

            collectLayers(doc);

            // 排序
            elements.sort((a, b) => {
                switch (sortBy) {
                    case 'position':
                        // 从上到下、从左到右
                        if (Math.abs(a.bounds.top - b.bounds.top) > 50) {
                            return a.bounds.top - b.bounds.top;
                        }
                        return a.bounds.left - b.bounds.left;
                    case 'size':
                        return (b.bounds.width * b.bounds.height) - (a.bounds.width * a.bounds.height);
                    case 'name':
                        return a.name.localeCompare(b.name);
                    case 'type':
                        return a.type.localeCompare(b.type);
                    default:
                        return 0;
                }
            });

            // 统计
            const summary = {
                totalElements: elements.length,
                textLayers: elements.filter(e => e.type === 'text').length,
                imageLayers: elements.filter(e => e.type === 'pixel' || e.type === 'smartObject').length,
                shapeLayers: elements.filter(e => e.type === 'shape').length,
                groups: elements.filter(e => e.type === 'group').length
            };

            return {
                success: true,
                elements,
                summary
            };

        } catch (error) {
            console.error('[GetElementMapping] Error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : '获取元素映射失败'
            };
        }
    }

    /**
     * 描述元素在画布中的位置
     */
    private describePosition(centerX: number, centerY: number, docWidth: number, docHeight: number): string {
        const xRatio = centerX / docWidth;
        const yRatio = centerY / docHeight;

        let vertical = '';
        let horizontal = '';

        if (yRatio < 0.33) vertical = '上';
        else if (yRatio > 0.67) vertical = '下';
        else vertical = '中';

        if (xRatio < 0.33) horizontal = '左';
        else if (xRatio > 0.67) horizontal = '右';
        else horizontal = '中';

        if (vertical === '中' && horizontal === '中') return '中央';
        if (vertical === '中') return horizontal + '侧';
        if (horizontal === '中') return vertical + '部';
        
        return vertical + horizontal + '角';
    }

    /**
     * 获取图层类型的可读名称
     */
    private getLayerType(layer: any): string {
        const kind = layer.kind;
        if (!kind) {
            if (layer.layers) return 'group';
            return 'unknown';
        }

        const kindStr = kind.toString().toLowerCase();
        
        if (kindStr.includes('text')) return 'text';
        if (kindStr.includes('pixel')) return 'pixel';
        if (kindStr.includes('smart')) return 'smartObject';
        if (kindStr.includes('shape')) return 'shape';
        if (kindStr.includes('adjustment')) return 'adjustment';
        if (kindStr.includes('group')) return 'group';
        if (kindStr.includes('solid')) return 'solidColor';
        if (kindStr.includes('gradient')) return 'gradient';
        if (kindStr.includes('pattern')) return 'pattern';
        
        return kindStr.replace('layerkind.', '');
    }
}

/**
 * 分析画面布局工具
 */
export class AnalyzeLayoutTool implements Tool {
    name = 'analyzeLayout';

    schema: ToolSchema = {
        name: 'analyzeLayout',
        description: '分析当前画面的布局结构，识别主体元素、标题、副标题、行动号召等设计元素的位置关系。适用于：理解设计结构、准备布局调整、生成布局建议。',
        parameters: {
            type: 'object',
            properties: {
                detectHierarchy: {
                    type: 'boolean',
                    description: '是否检测元素层级关系（标题/副标题/正文等），默认 true'
                },
                detectAlignment: {
                    type: 'boolean',
                    description: '是否检测对齐关系，默认 true'
                }
            }
        }
    };

    async execute(params: {
        detectHierarchy?: boolean;
        detectAlignment?: boolean;
    }): Promise<{
        success: boolean;
        layout?: {
            type: string;  // 布局类型推断
            mainElements: Array<{
                role: string;  // 元素角色（主标题、副标题、主图、CTA等）
                layerId: number;
                layerName: string;
                confidence: number;
            }>;
            alignmentGroups: Array<{
                type: string;  // 对齐类型
                layerIds: number[];
            }>;
            suggestions: string[];
        };
        error?: string;
    }> {
        try {
            const doc = app.activeDocument;
            if (!doc) {
                return { success: false, error: '没有打开的文档' };
            }

            const detectHierarchy = params.detectHierarchy !== false;
            const detectAlignment = params.detectAlignment !== false;

            // 收集所有可见图层
            const layers: any[] = [];
            const collectLayers = (container: any) => {
                for (const layer of container.layers) {
                    if (!layer.visible) continue;
                    
                    let bounds = { left: 0, top: 0, right: 0, bottom: 0 };
                    try { bounds = layer.bounds; } catch {}
                    
                    layers.push({
                        id: layer.id,
                        name: layer.name,
                        type: this.getLayerType(layer),
                        bounds,
                        width: bounds.right - bounds.left,
                        height: bounds.bottom - bounds.top,
                        centerX: bounds.left + (bounds.right - bounds.left) / 2,
                        centerY: bounds.top + (bounds.bottom - bounds.top) / 2,
                        textContent: this.getTextContent(layer),
                        fontSize: this.getFontSize(layer)
                    });

                    if (layer.layers) collectLayers(layer);
                }
            };
            collectLayers(doc);

            // 分析主要元素
            const mainElements: any[] = [];
            
            if (detectHierarchy) {
                // 检测主标题（最大字号的文本）
                const textLayers = layers.filter(l => l.type === 'text' && l.fontSize);
                if (textLayers.length > 0) {
                    textLayers.sort((a, b) => (b.fontSize || 0) - (a.fontSize || 0));
                    
                    // 最大字号为主标题
                    mainElements.push({
                        role: '主标题',
                        layerId: textLayers[0].id,
                        layerName: textLayers[0].name,
                        confidence: 0.8
                    });

                    // 第二大字号为副标题
                    if (textLayers.length > 1) {
                        mainElements.push({
                            role: '副标题',
                            layerId: textLayers[1].id,
                            layerName: textLayers[1].name,
                            confidence: 0.6
                        });
                    }
                }

                // 检测主图（最大的非文本图层）
                const imageLayers = layers.filter(l => 
                    l.type === 'pixel' || l.type === 'smartObject'
                );
                if (imageLayers.length > 0) {
                    imageLayers.sort((a, b) => (b.width * b.height) - (a.width * a.height));
                    mainElements.push({
                        role: '主图/产品图',
                        layerId: imageLayers[0].id,
                        layerName: imageLayers[0].name,
                        confidence: 0.7
                    });
                }
            }

            // 检测对齐组
            const alignmentGroups: any[] = [];
            
            if (detectAlignment) {
                // 检测左对齐
                const leftAligned = this.findAlignedLayers(layers, 'left', 10);
                if (leftAligned.length >= 2) {
                    alignmentGroups.push({
                        type: '左对齐',
                        layerIds: leftAligned.map(l => l.id)
                    });
                }

                // 检测中心对齐
                const centerAligned = this.findAlignedLayers(layers, 'centerX', 10);
                if (centerAligned.length >= 2) {
                    alignmentGroups.push({
                        type: '水平居中',
                        layerIds: centerAligned.map(l => l.id)
                    });
                }
            }

            // 推断布局类型
            const layoutType = this.inferLayoutType(layers, doc.width, doc.height);

            // 生成建议
            const suggestions: string[] = [];
            if (mainElements.length === 0) {
                suggestions.push('未检测到明显的主体元素，建议添加主标题或主图');
            }
            if (alignmentGroups.length === 0) {
                suggestions.push('元素未形成明显的对齐关系，建议调整对齐');
            }

            return {
                success: true,
                layout: {
                    type: layoutType,
                    mainElements,
                    alignmentGroups,
                    suggestions
                }
            };

        } catch (error) {
            console.error('[AnalyzeLayout] Error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : '分析布局失败'
            };
        }
    }

    private getLayerType(layer: any): string {
        const kind = layer.kind?.toString().toLowerCase() || '';
        if (kind.includes('text')) return 'text';
        if (kind.includes('pixel')) return 'pixel';
        if (kind.includes('smart')) return 'smartObject';
        if (kind.includes('shape')) return 'shape';
        if (layer.layers) return 'group';
        return 'other';
    }

    private getTextContent(layer: any): string | null {
        try {
            if (layer.kind?.toString().toLowerCase().includes('text')) {
                return (layer as any).textItem?.contents || null;
            }
        } catch {}
        return null;
    }

    private getFontSize(layer: any): number | null {
        try {
            if (layer.kind?.toString().toLowerCase().includes('text')) {
                return (layer as any).textItem?.size || null;
            }
        } catch {}
        return null;
    }

    private findAlignedLayers(layers: any[], property: string, tolerance: number): any[] {
        const groups: Map<number, any[]> = new Map();
        
        for (const layer of layers) {
            const value = Math.round(layer[property] / tolerance) * tolerance;
            if (!groups.has(value)) {
                groups.set(value, []);
            }
            groups.get(value)!.push(layer);
        }

        // 返回最大的组
        let maxGroup: any[] = [];
        for (const group of groups.values()) {
            if (group.length > maxGroup.length) {
                maxGroup = group;
            }
        }
        
        return maxGroup;
    }

    private inferLayoutType(layers: any[], docWidth: number, docHeight: number): string {
        // 根据元素分布推断布局类型
        const isVertical = docHeight > docWidth;
        const hasHeaderArea = layers.some(l => l.centerY < docHeight * 0.3);
        const hasFooterArea = layers.some(l => l.centerY > docHeight * 0.7);
        
        if (isVertical && hasHeaderArea && hasFooterArea) {
            return '详情页式布局';
        }
        if (!isVertical) {
            return '横版主图布局';
        }
        return '标准布局';
    }
}
