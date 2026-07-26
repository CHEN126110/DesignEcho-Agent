/**
 * 图层查找工具（查询式读取，2026-07-07）
 *
 * 治"翻树找层"模式：模型要的是「组 12 里名字含 00 拷贝 9 的矩形」这类查询，
 * 全量层级树在大文档上必然截断（真机 113 层文档绕 7 轮才靠 selectLayer 副作用拿到 id）。
 * 本工具按条件过滤，返回扁平结果（含 id/类型/边界/路径），天然不受嵌套深度截断影响。
 */

import { Tool, ToolSchema } from '../types';

const app = require('photoshop').app;

interface FoundLayer {
    id: number;
    name: string;
    kind: string;
    visible: boolean;
    parentName: string | null;
    /** 从顶层到该图层的路径（按名称，/ 分隔） */
    path: string;
    bounds?: { left: number; top: number; right: number; bottom: number; width: number; height: number };
}

const KIND_MAP: Record<number, string> = {
    1: 'pixel', 2: 'adjustment', 3: 'text', 4: 'shape', 5: 'smartObject',
    6: 'video', 7: 'group', 8: '3d', 9: 'gradient', 10: 'pattern', 11: 'solidColor', 12: 'background'
};

function resolveKind(layer: any): string {
    const kind = layer?.kind;
    if (typeof kind === 'number') return KIND_MAP[kind] || `type_${kind}`;
    const raw = String(kind?.value ?? kind?._value ?? kind ?? '').replace(/^LayerKind\./i, '').toUpperCase();
    const byName: Record<string, string> = {
        PIXEL: 'pixel', ADJUSTMENT: 'adjustment', TEXT: 'text', VECTOR: 'shape',
        SMARTOBJECT: 'smartObject', GROUP: 'group', SOLIDCOLOR: 'solidColor',
        GRADIENTFILL: 'gradient', PATTERNFILL: 'pattern', BACKGROUNDSHEET: 'background', NORMAL: 'pixel'
    };
    return byName[raw] || (raw ? raw.toLowerCase() : 'unknown');
}

function findLayerByIdDeep(container: any, id: number): any {
    for (const layer of container.layers || []) {
        if (layer.id === id) return layer;
        if (layer.layers) {
            const found = findLayerByIdDeep(layer, id);
            if (found) return found;
        }
    }
    return null;
}

export class FindLayersTool implements Tool {
    name = 'findLayers';

    schema: ToolSchema = {
        name: 'findLayers',
        description: '按条件查找图层（名称包含/精确、类型、限定组内），返回扁平列表（id/类型/边界/路径）。找特定图层（如「组 12 里的 00 拷贝 9」）用它一步命中，不要用 getLayerHierarchy 翻树——大文档层级树会被截断。',
        parameters: {
            type: 'object',
            properties: {
                nameContains: {
                    type: 'string',
                    description: '名称包含（忽略大小写）。与 nameEquals 二选一'
                },
                nameEquals: {
                    type: 'string',
                    description: '名称精确匹配'
                },
                kind: {
                    type: 'string',
                    enum: ['pixel', 'text', 'shape', 'smartObject', 'group', 'solidColor', 'adjustment'],
                    description: '按图层类型过滤（可选）'
                },
                withinGroupId: {
                    type: 'number',
                    description: '只在该图层组内查找（可选；不给则全文档）'
                },
                includeBounds: {
                    type: 'boolean',
                    description: '是否返回边界，默认 true'
                },
                limit: {
                    type: 'number',
                    description: '返回条数上限，默认 20，最大 50'
                }
            }
        }
    };

    async execute(params: {
        nameContains?: string;
        nameEquals?: string;
        kind?: string;
        withinGroupId?: number;
        includeBounds?: boolean;
        limit?: number;
    }): Promise<{
        success: boolean;
        matches?: FoundLayer[];
        totalMatched?: number;
        truncated?: boolean;
        searchedWithin?: string;
        error?: string;
    }> {
        try {
            const doc = app.activeDocument;
            if (!doc) {
                return { success: false, error: '没有打开的文档' };
            }
            const nameContains = String(params.nameContains || '').trim().toLowerCase();
            const nameEquals = String(params.nameEquals || '').trim();
            const kindFilter = String(params.kind || '').trim();
            if (!nameContains && !nameEquals && !kindFilter) {
                return { success: false, error: 'findLayers 需要至少一个条件：nameContains / nameEquals / kind。全量结构请用 getLayerHierarchy（大文档配 rootLayerId）。' };
            }

            let root: any = doc;
            let searchedWithin = '(整个文档)';
            if (params.withinGroupId) {
                const group = findLayerByIdDeep(doc, Number(params.withinGroupId));
                if (!group) {
                    return { success: false, error: `未找到 withinGroupId=${params.withinGroupId} 的图层组。可先用 findLayers({nameContains:'组名', kind:'group'}) 找组 id。` };
                }
                if (!group.layers) {
                    return { success: false, error: `图层「${group.name}」(ID: ${group.id}) 不是图层组，无法在其内查找。` };
                }
                root = group;
                searchedWithin = `组「${group.name}」(ID: ${group.id})`;
            }

            const includeBounds = params.includeBounds !== false;
            const limit = Math.max(1, Math.min(50, Number(params.limit) || 20));
            const matches: FoundLayer[] = [];
            let totalMatched = 0;

            const walk = (container: any, pathNames: string[]): void => {
                for (const layer of container.layers || []) {
                    const layerName = String(layer.name || '');
                    const layerKind = resolveKind(layer);
                    const nameOk = nameEquals
                        ? layerName === nameEquals
                        : (nameContains ? layerName.toLowerCase().includes(nameContains) : true);
                    const kindOk = kindFilter ? layerKind === kindFilter : true;
                    if (nameOk && kindOk) {
                        totalMatched += 1;
                        if (matches.length < limit) {
                            const entry: FoundLayer = {
                                id: layer.id,
                                name: layerName,
                                kind: layerKind,
                                visible: layer.visible !== false,
                                parentName: container === doc ? null : String(container.name || ''),
                                path: [...pathNames, layerName].join('/')
                            };
                            if (includeBounds) {
                                try {
                                    const bounds = layer.boundsNoEffects || layer.bounds;
                                    if (bounds) {
                                        entry.bounds = {
                                            left: Number(bounds.left), top: Number(bounds.top),
                                            right: Number(bounds.right), bottom: Number(bounds.bottom),
                                            width: Number(bounds.right) - Number(bounds.left),
                                            height: Number(bounds.bottom) - Number(bounds.top)
                                        };
                                    }
                                } catch {
                                    // 个别图层读不到边界，跳过该字段
                                }
                            }
                            matches.push(entry);
                        }
                    }
                    if (layer.layers) {
                        walk(layer, [...pathNames, layerName]);
                    }
                }
            };
            walk(root, root === doc ? [] : [String(root.name || '')]);

            return {
                success: true,
                matches,
                totalMatched,
                truncated: totalMatched > matches.length,
                searchedWithin
            };
        } catch (error) {
            return {
                success: false,
                error: `findLayers 执行失败：${error instanceof Error ? error.message : String(error)}`
            };
        }
    }
}
