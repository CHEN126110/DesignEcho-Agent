/**
 * Photoshop 验收快照工具
 *
 * 只读取当前文档的结构化状态，不读取像素，也不修改 Photoshop。
 * 目标是给 Agent / 开发者提供可复核的结构检查结果，而不是替代视觉截图。
 */

import { Tool, ToolSchema } from '../types';
import {
    observeActiveDocumentAtHistoryState,
    PhotoshopDocumentObservationError
} from '../../core/photoshop-document-observation';
import type { PhotoshopHistoryStateRef } from '../../core/photoshop-history-state-ref';

interface AcceptanceBounds {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
}

interface AcceptanceTextStyle {
    fontName?: string;
    fontStyle?: string;
    fontSize?: number;
    tracking?: number;
    leading?: number;
    horizontalScale?: number;
    verticalScale?: number;
}

type AcceptanceEditabilityCategory =
    | 'editable_text'
    | 'editable_shape'
    | 'editable_smart_object'
    | 'raster_only'
    | 'group'
    | 'unknown';

interface AcceptanceEditability {
    category: AcceptanceEditabilityCategory;
    editable: boolean | null;
    reasons: string[];
    warnings: string[];
}

interface AcceptanceLayer {
    id: number;
    name: string;
    kind: string;
    visible: boolean;
    locked: boolean;
    opacity?: number;
    blendMode?: string;
    depth: number;
    index: number;
    parentId: number | null;
    parentName: string | null;
    path: string;
    selected: boolean;
    editability: AcceptanceEditability;
    bounds?: AcceptanceBounds;
    boundsNoEffects?: AcceptanceBounds;
    text?: {
        content: string;
        length: number;
        style?: AcceptanceTextStyle;
    };
}

interface AcceptanceSummary {
    totalLayers: number;
    selectedLayers: number;
    hiddenLayers: number;
    lockedLayers: number;
    textLayers: number;
    groupLayers: number;
    smartObjectLayers: number;
    shapeLayers: number;
    pixelLayers: number;
    editableTextLayers: number;
    editableShapeLayers: number;
    editableSmartObjectLayers: number;
    rasterOnlyLayers: number;
    unknownEditabilityLayers: number;
    editableLayerRatio: number;
    truncated: boolean;
}

export class GetAcceptanceSnapshotTool implements Tool {
    name = 'getAcceptanceSnapshot';

    schema: ToolSchema = {
        name: 'getAcceptanceSnapshot',
        description: '获取当前 Photoshop 文档的轻量验收快照，只读返回文档、图层、文字、边界、选中状态等结构化结果，用于任务完成后的验证和 Debug。',
        parameters: {
            type: 'object',
            properties: {
                includeHidden: {
                    type: 'boolean',
                    description: '是否包含隐藏图层，默认 true'
                },
                includeBounds: {
                    type: 'boolean',
                    description: '是否读取图层边界，默认 true'
                },
                includeText: {
                    type: 'boolean',
                    description: '是否读取文本内容和基础字体信息，默认 true'
                },
                maxLayers: {
                    type: 'number',
                    description: '最多读取多少个图层，默认 300，超过后截断并返回 warnings'
                }
            }
        }
    };

    async execute(params: {
        includeHidden?: boolean;
        includeBounds?: boolean;
        includeText?: boolean;
        maxLayers?: number;
    }): Promise<Record<string, unknown> & { historyStateRef?: PhotoshopHistoryStateRef }> {
        const generatedAt = new Date().toISOString();

        try {
            const observation = await observeActiveDocumentAtHistoryState({
                commandName: 'DesignEcho: 获取验收快照',
                timeOut: 5,
                unavailableMessage: '无法读取 Photoshop 文档历史版本，未返回可能过期的验收快照。',
                changedMessage: '读取验收快照期间 Photoshop 文档发生变化，已丢弃这次不一致的验收结果。'
            }, (doc) => {
                const includeHidden = params.includeHidden !== false;
                const includeBounds = params.includeBounds !== false;
                const includeText = params.includeText !== false;
                const maxLayers = this.normalizeMaxLayers(params.maxLayers);
                const selectedIds = new Set<number>((doc.activeLayers || []).map((layer: any) => Number(layer.id)));
                const warnings: string[] = [];
                const layers: AcceptanceLayer[] = [];

                this.collectLayers({
                    container: doc,
                    result: layers,
                    selectedIds,
                    includeHidden,
                    includeBounds,
                    includeText,
                    maxLayers,
                    warnings,
                    parentId: null,
                    parentName: null,
                    depth: 0,
                    parentPath: []
                });

                const summary = this.buildSummary(layers, warnings.some((warning) => warning.includes('截断')));

                return {
                    hasDocument: true,
                    generatedAt,
                    document: {
                        id: doc.id,
                        name: doc.name,
                        width: this.toNumber(doc.width),
                        height: this.toNumber(doc.height),
                        resolution: this.toNumber(doc.resolution),
                        mode: doc.mode?.toString?.() || String(doc.mode || 'unknown')
                    },
                    selectedLayerIds: Array.from(selectedIds),
                    summary,
                    editabilitySummary: {
                        editableTextLayers: summary.editableTextLayers,
                        editableShapeLayers: summary.editableShapeLayers,
                        editableSmartObjectLayers: summary.editableSmartObjectLayers,
                        rasterOnlyLayers: summary.rasterOnlyLayers,
                        unknownEditabilityLayers: summary.unknownEditabilityLayers,
                        editableLayerRatio: summary.editableLayerRatio
                    },
                    layers,
                    warnings
                };
            });

            return {
                success: true,
                ...observation.value,
                historyStateRef: observation.historyStateRef
            };
        } catch (error: any) {
            if (error instanceof PhotoshopDocumentObservationError && error.code === 'no_active_document') {
                return {
                    success: true,
                    hasDocument: false,
                    documentState: 'absent',
                    generatedAt,
                    warnings: ['当前没有打开的 Photoshop 文档，无法采集验收快照。']
                };
            }
            console.error('[GetAcceptanceSnapshot] Error:', error);
            return {
                success: false,
                hasDocument: false,
                generatedAt,
                errorCode: error instanceof PhotoshopDocumentObservationError
                    ? error.code
                    : 'get_acceptance_snapshot_failed',
                error: error?.message || '获取验收快照失败'
            };
        }
    }

    private normalizeMaxLayers(input: unknown): number {
        if (typeof input !== 'number' || !Number.isFinite(input)) return 300;
        return Math.max(1, Math.min(1000, Math.floor(input)));
    }

    private collectLayers(args: {
        container: any;
        result: AcceptanceLayer[];
        selectedIds: Set<number>;
        includeHidden: boolean;
        includeBounds: boolean;
        includeText: boolean;
        maxLayers: number;
        warnings: string[];
        parentId: number | null;
        parentName: string | null;
        depth: number;
        parentPath: string[];
    }): void {
        const sourceLayers = this.readLayerList(args.container, args.warnings, args.parentPath.join('/') || '文档根层级');

        for (let index = 0; index < sourceLayers.length; index++) {
            if (args.result.length >= args.maxLayers) {
                if (!args.warnings.some((warning) => warning.includes('截断'))) {
                    args.warnings.push(`图层数量超过 maxLayers=${args.maxLayers}，验收快照已截断。`);
                }
                return;
            }

            const layer = sourceLayers[index];
            const fallbackPath = [...args.parentPath, `Layer ${index + 1}`].join('/');
            let layerInfo: AcceptanceLayer;
            let pathParts: string[];
            let kind: string;

            try {
                const layerId = Number(layer.id);
                const layerName = String(layer.name || `Layer ${layerId}`);
                const visible = layer.visible !== false;
                if (!args.includeHidden && !visible) {
                    continue;
                }

                kind = this.getLayerKind(layer);
                pathParts = [...args.parentPath, layerName];
                layerInfo = {
                    id: layerId,
                    name: layerName,
                    kind,
                    visible,
                    locked: Boolean(layer.locked || layer.allLocked),
                    opacity: this.toOptionalNumber(layer.opacity),
                    blendMode: layer.blendMode?.toString?.() || String(layer.blendMode || 'normal'),
                    depth: args.depth,
                    index,
                    parentId: args.parentId,
                    parentName: args.parentName,
                    path: pathParts.join('/'),
                    selected: args.selectedIds.has(layerId),
                    editability: this.getLayerEditability(kind)
                };
            } catch (error: any) {
                args.warnings.push(`跳过失效图层 ${fallbackPath || `index=${index}`}：${this.normalizeLayerReadError(error)}`);
                continue;
            }

            if (args.includeBounds) {
                try {
                    const bounds = this.readBounds(layer.bounds);
                    const boundsNoEffects = this.readBounds(layer.boundsNoEffects);
                    if (bounds) layerInfo.bounds = bounds;
                    if (boundsNoEffects) layerInfo.boundsNoEffects = boundsNoEffects;
                } catch (error: any) {
                    args.warnings.push(`跳过失效图层 ${layerInfo.path} 的边界信息：${this.normalizeLayerReadError(error)}`);
                }
            }

            if (args.includeText && kind === 'text') {
                try {
                    layerInfo.text = this.readText(layer);
                } catch (error: any) {
                    args.warnings.push(`跳过失效图层 ${layerInfo.path} 的文字信息：${this.normalizeLayerReadError(error)}`);
                }
            }

            args.result.push(layerInfo);

            const childLayers = kind === 'group'
                ? this.readLayerList(layer, args.warnings, layerInfo.path)
                : [];
            if (childLayers.length > 0) {
                this.collectLayers({
                    ...args,
                    container: { layers: childLayers },
                    parentId: layerInfo.id,
                    parentName: layerInfo.name,
                    depth: args.depth + 1,
                    parentPath: pathParts
                });
            }
        }
    }

    private readLayerList(container: any, warnings: string[], contextPath: string): any[] {
        try {
            const layers = container?.layers;
            if (!layers) return [];
            return Array.from(layers) as any[];
        } catch (error: any) {
            warnings.push(`跳过失效图层 ${contextPath || '未知层级'} 的子图层读取：${this.normalizeLayerReadError(error)}`);
            return [];
        }
    }

    private normalizeLayerReadError(error: any): string {
        const message = error?.message ? String(error.message) : String(error || '未知错误');
        return message.replace(/\s+/g, ' ').trim() || '未知错误';
    }

    private buildSummary(layers: AcceptanceLayer[], truncated: boolean): AcceptanceSummary {
        const nonGroupLayers = layers.filter((layer) => layer.editability.category !== 'group');
        const editableLayers = nonGroupLayers.filter((layer) => layer.editability.editable === true);
        const editableLayerRatio = nonGroupLayers.length > 0
            ? Math.round((editableLayers.length / nonGroupLayers.length) * 100) / 100
            : 0;

        return {
            totalLayers: layers.length,
            selectedLayers: layers.filter((layer) => layer.selected).length,
            hiddenLayers: layers.filter((layer) => !layer.visible).length,
            lockedLayers: layers.filter((layer) => layer.locked).length,
            textLayers: layers.filter((layer) => layer.kind === 'text').length,
            groupLayers: layers.filter((layer) => layer.kind === 'group').length,
            smartObjectLayers: layers.filter((layer) => layer.kind === 'smartObject').length,
            shapeLayers: layers.filter((layer) => layer.kind === 'shape' || layer.kind === 'solidColor').length,
            pixelLayers: layers.filter((layer) => layer.kind === 'pixel').length,
            editableTextLayers: layers.filter((layer) => layer.editability.category === 'editable_text').length,
            editableShapeLayers: layers.filter((layer) => layer.editability.category === 'editable_shape').length,
            editableSmartObjectLayers: layers.filter((layer) => layer.editability.category === 'editable_smart_object').length,
            rasterOnlyLayers: layers.filter((layer) => layer.editability.category === 'raster_only').length,
            unknownEditabilityLayers: layers.filter((layer) => layer.editability.category === 'unknown').length,
            editableLayerRatio,
            truncated
        };
    }

    private getLayerEditability(kind: string): AcceptanceEditability {
        if (kind === 'text') {
            return {
                category: 'editable_text',
                editable: true,
                reasons: ['文本图层保留 Photoshop 文本对象，可用于检查复刻结果是否仍可编辑。'],
                warnings: []
            };
        }

        const editableShapeKinds = new Set(['shape', 'solidColor', 'vector']);
        if (editableShapeKinds.has(kind)) {
            return {
                category: 'editable_shape',
                editable: true,
                reasons: ['形状或矢量填充图层保留结构化形状属性，可用于检查复刻结果是否仍可编辑。'],
                warnings: []
            };
        }

        if (kind === 'smartObject') {
            return {
                category: 'editable_smart_object',
                editable: true,
                reasons: ['智能对象图层保留可替换或可进入编辑的对象容器。'],
                warnings: ['智能对象内容是否完全可复刻，需要通过 replace/edit smart object 流程另行验证。']
            };
        }

        const rasterOnlyKinds = new Set(['pixel', 'background']);
        if (rasterOnlyKinds.has(kind)) {
            return {
                category: 'raster_only',
                editable: false,
                reasons: ['该图层是栅格或背景图层，不属于文本、形状、智能对象这类结构化可编辑图层。'],
                warnings: []
            };
        }

        if (kind === 'group') {
            return {
                category: 'group',
                editable: null,
                reasons: ['组图层用于组织层级，本身不代表具体可编辑内容。'],
                warnings: []
            };
        }

        return {
            category: 'unknown',
            editable: null,
            reasons: [],
            warnings: [`无法确定 kind=${kind || 'unknown'} 图层的结构化可编辑性，验收时不要把它误判为可编辑或不可编辑。`]
        };
    }

    private readText(layer: any): AcceptanceLayer['text'] {
        const textItem = layer.textItem;
        const content = String(textItem?.contents || '');
        const characterStyle = textItem?.characterStyle || {};
        const style: AcceptanceTextStyle = {};

        this.assignIfNumber(style, 'fontSize', characterStyle.size);
        this.assignIfNumber(style, 'tracking', characterStyle.tracking);
        this.assignIfNumber(style, 'leading', characterStyle.leading);
        this.assignIfNumber(style, 'horizontalScale', characterStyle.horizontalScale);
        this.assignIfNumber(style, 'verticalScale', characterStyle.verticalScale);

        if (characterStyle.font) style.fontName = String(characterStyle.font);
        if (characterStyle.fontStyle) style.fontStyle = String(characterStyle.fontStyle);

        return {
            content,
            length: content.length,
            style: Object.keys(style).length > 0 ? style : undefined
        };
    }

    private assignIfNumber(target: AcceptanceTextStyle, key: keyof AcceptanceTextStyle, value: unknown): void {
        const numberValue = this.toOptionalNumber(value);
        if (typeof numberValue === 'number') {
            (target as Record<string, number>)[key] = numberValue;
        }
    }

    private readBounds(input: any): AcceptanceBounds | undefined {
        if (!input) return undefined;
        const left = this.toOptionalNumber(input.left);
        const top = this.toOptionalNumber(input.top);
        const right = this.toOptionalNumber(input.right);
        const bottom = this.toOptionalNumber(input.bottom);

        if ([left, top, right, bottom].some((value) => typeof value !== 'number')) {
            return undefined;
        }

        const width = this.toOptionalNumber(input.width) ?? Number(right) - Number(left);
        const height = this.toOptionalNumber(input.height) ?? Number(bottom) - Number(top);

        return {
            left: Number(left),
            top: Number(top),
            right: Number(right),
            bottom: Number(bottom),
            width,
            height
        };
    }

    private toOptionalNumber(input: unknown): number | undefined {
        if (typeof input === 'number' && Number.isFinite(input)) {
            return this.round(input);
        }
        if (input && typeof input === 'object') {
            const candidate = (input as Record<string, unknown>).value;
            if (typeof candidate === 'number' && Number.isFinite(candidate)) {
                return this.round(candidate);
            }
        }
        if (typeof input === 'string' && input.trim()) {
            const parsed = Number.parseFloat(input);
            if (Number.isFinite(parsed)) return this.round(parsed);
        }
        return undefined;
    }

    private toNumber(input: unknown): number | undefined {
        return this.toOptionalNumber(input);
    }

    private round(value: number): number {
        return Math.round(value * 100) / 100;
    }

    private getLayerKind(layer: any): string {
        const kind = layer?.kind;
        if (!kind) return 'unknown';

        const kindMap: Record<number, string> = {
            1: 'pixel',
            2: 'adjustment',
            3: 'text',
            4: 'shape',
            5: 'smartObject',
            6: 'video',
            7: 'group',
            8: '3d',
            9: 'gradient',
            10: 'pattern',
            11: 'solidColor',
            12: 'background'
        };
        const kindNameMap: Record<string, string> = {
            PIXEL: 'pixel',
            ADJUSTMENT: 'adjustment',
            TEXT: 'text',
            SOLIDCOLOR: 'solidColor',
            GRADIENTFILL: 'gradient',
            PATTERNFILL: 'pattern',
            SMARTOBJECT: 'smartObject',
            VIDEO: 'video',
            LAYER3D: '3d',
            GROUP: 'group',
            BACKGROUNDSHEET: 'background',
            VECTOR: 'shape',
            NORMAL: 'pixel'
        };

        if (typeof kind === 'number') return kindMap[kind] || `type_${kind}`;
        if (typeof kind === 'object') {
            const value = kind.value ?? kind._value ?? kind;
            if (typeof value === 'number') return kindMap[value] || `type_${value}`;
            if (typeof value === 'string') return kindNameMap[value.toUpperCase()] || value.toLowerCase();
        }
        if (typeof kind === 'string') {
            const cleanKind = kind.replace(/^LayerKind\./i, '').toUpperCase();
            return kindNameMap[cleanKind] || kind.toLowerCase();
        }

        const text = kind.toString?.() || 'unknown';
        const cleanText = text.replace(/^LayerKind\./i, '').toUpperCase();
        return kindNameMap[cleanText] || text.toLowerCase();
    }
}
