/**
 * 聚焦图层工具
 *
 * 第一阶段只做 UXP 能稳定证明的事情：选中图层、拉起 Photoshop、刷新 UI、返回真实 bounds。
 * Photoshop UXP 当前没有稳定公开的“按区域平移/居中画布视口”DOM API，不能伪装成已完成精确视口聚焦。
 */

import { Tool, ToolSchema, LayerBounds } from '../types';
import { createToolFailureResult } from '../../core/tool-error-normalizer';
import { getPhotoshopAppUiMethods } from './photoshop-runtime-adapters';

const app = require('photoshop').app;
const { core, action } = require('photoshop');
const appUi = getPhotoshopAppUiMethods(app);

type FocusLayerParams = {
    layerId?: number | string;
    layerName?: string;
    includeBounds?: boolean;
};

type LayerSummary = {
    id: number;
    name: string;
    kind: string;
};

function toNumber(value: any): number {
    const raw = value && typeof value === 'object' && '_value' in value ? value._value : value;
    const numeric = Number(raw);
    return Number.isFinite(numeric) ? numeric : 0;
}

function readBounds(bounds: any): LayerBounds | undefined {
    if (!bounds) return undefined;
    const left = toNumber(bounds.left);
    const top = toNumber(bounds.top);
    const right = toNumber(bounds.right);
    const bottom = toNumber(bounds.bottom);
    return {
        left,
        top,
        right,
        bottom,
        width: Math.max(0, right - left),
        height: Math.max(0, bottom - top)
    };
}

export class FocusLayerTool implements Tool {
    name = 'focusLayer';

    schema: ToolSchema = {
        name: 'focusLayer',
        description: '将用户注意力聚焦到指定 Photoshop 图层：选中图层、前置 Photoshop、刷新 UI，并返回真实图层边界。当前不承诺精确平移/缩放画布视口。',
        parameters: {
            type: 'object',
            properties: {
                layerId: {
                    type: 'number',
                    description: '要聚焦的图层 ID。优先使用 ID，避免同名图层歧义。'
                },
                layerName: {
                    type: 'string',
                    description: '要聚焦的图层名称。仅在没有 layerId 时使用；若存在多个同名或包含匹配会返回歧义。'
                },
                includeBounds: {
                    type: 'boolean',
                    description: '是否返回图层真实边界，默认 true。'
                }
            }
        }
    };

    async execute(params: FocusLayerParams): Promise<{
        success: boolean;
        focusedLayer?: LayerSummary;
        bounds?: LayerBounds;
        boundsNoEffects?: LayerBounds;
        focusActions?: string[];
        viewport?: {
            exactPanZoomSupported: false;
            pannedOrZoomed: false;
            reason: string;
        };
        candidates?: LayerSummary[];
        error?: string;
    }> {
        try {
            const doc = app.activeDocument;
            if (!doc) {
                return { success: false, error: '没有打开的文档' };
            }

            const targetLayer = this.resolveTargetLayer(doc, params);
            if (!targetLayer.success) {
                return {
                    success: false,
                    error: targetLayer.error,
                    candidates: targetLayer.candidates
                };
            }

            const layer = targetLayer.layer;
            const focusActions: string[] = [];

            await core.executeAsModal(async () => {
                await action.batchPlay([{
                    _obj: 'select',
                    _target: [{ _ref: 'layer', _id: Number(layer.id) }],
                    makeVisible: true,
                    _options: { dialogOptions: 'dontDisplay' }
                }], { synchronousExecution: true });
                focusActions.push('selectLayer(makeVisible=true)');

                if (typeof appUi.bringToFront === 'function') {
                    appUi.bringToFront();
                    focusActions.push('app.bringToFront');
                }

                if (typeof appUi.updateUI === 'function') {
                    await appUi.updateUI();
                    focusActions.push('app.updateUI');
                }
            }, { commandName: 'DesignEcho: 聚焦图层' });

            const includeBounds = params.includeBounds !== false;
            const bounds = includeBounds ? readBounds(layer.bounds) : undefined;
            const boundsNoEffects = includeBounds ? readBounds(layer.boundsNoEffects || layer.bounds) : undefined;

            return {
                success: true,
                focusedLayer: {
                    id: Number(layer.id),
                    name: String(layer.name || ''),
                    kind: layer.kind?.toString?.() || 'unknown'
                },
                bounds,
                boundsNoEffects,
                focusActions,
                viewport: {
                    exactPanZoomSupported: false,
                    pannedOrZoomed: false,
                    reason: '当前实现只做稳定可验证的图层选择和 Photoshop 前置；精确画布平移/缩放需要单独验证 Photoshop action descriptor 或外部 UI Automation。'
                }
            };
        } catch (error) {
            console.error('[FocusLayer] Error:', error);
            return createToolFailureResult({ toolName: this.name, error, params });
        }
    }

    private resolveTargetLayer(container: any, params: FocusLayerParams): {
        success: true;
        layer: any;
    } | {
        success: false;
        error: string;
        candidates?: LayerSummary[];
    } {
        if (params.layerId !== undefined && params.layerId !== null) {
            const numericId = typeof params.layerId === 'string' ? Number.parseInt(params.layerId, 10) : params.layerId;
            if (!Number.isFinite(numericId)) {
                return { success: false, error: `无效图层 ID: ${params.layerId}` };
            }
            const layer = this.findLayerById(container, Number(numericId));
            if (!layer) {
                return { success: false, error: `未找到图层 ID: ${params.layerId}` };
            }
            return { success: true, layer };
        }

        const layerName = String(params.layerName || '').trim();
        if (!layerName) {
            return { success: false, error: '请提供 layerId 或 layerName' };
        }

        const exactMatches = this.getAllLayers(container).filter((layer) => layer.name === layerName);
        if (exactMatches.length === 1) {
            const layer = this.findLayerById(container, exactMatches[0].id);
            return layer ? { success: true, layer } : { success: false, error: `未找到图层: ${layerName}` };
        }
        if (exactMatches.length > 1) {
            return {
                success: false,
                error: `存在多个同名图层: ${layerName}。请改用 layerId。`,
                candidates: exactMatches
            };
        }

        const partialMatches = this.getAllLayers(container).filter((layer) => layer.name.includes(layerName));
        if (partialMatches.length === 1) {
            const layer = this.findLayerById(container, partialMatches[0].id);
            return layer ? { success: true, layer } : { success: false, error: `未找到图层: ${layerName}` };
        }

        return {
            success: false,
            error: partialMatches.length > 1
                ? `存在多个包含“${layerName}”的图层。请改用 layerId。`
                : `未找到名称为“${layerName}”的图层。`,
            candidates: partialMatches.slice(0, 10)
        };
    }

    private findLayerById(container: any, id: number): any {
        for (const layer of container.layers || []) {
            if (Number(layer.id) === id) return layer;
            if (layer.layers) {
                const found = this.findLayerById(layer, id);
                if (found) return found;
            }
        }
        return null;
    }

    private getAllLayers(container: any): LayerSummary[] {
        const layers: LayerSummary[] = [];
        for (const layer of container.layers || []) {
            layers.push({
                id: Number(layer.id),
                name: String(layer.name || ''),
                kind: layer.kind?.toString?.() || 'unknown'
            });
            if (layer.layers) layers.push(...this.getAllLayers(layer));
        }
        return layers;
    }
}
