import { Tool, ToolSchema } from '../types';
import {
    assertImageBytesSafeForPhotoshop,
    readFileEntryBytes
} from '../../core/image-safety';
import { createToolFailureResult } from '../../core/tool-error-normalizer';

const photoshop = require('photoshop');
const { app, action } = photoshop;
const { executeAsModal } = photoshop.core;
const { storage } = require('uxp');

interface SmartObjectToolResult {
    success: boolean;
    entityType?: string;
    documentId?: number;
    layerId?: number;
    name?: string;
    message?: string;
    error?: string;
    [key: string]: any;
}

function isPositiveNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

function extensionFromPath(filePath: string): string {
    const match = String(filePath || '').match(/\.([a-z0-9]+)$/i);
    return match ? match[1].toLowerCase() : '';
}

function basenameFromPath(filePath: string): string {
    return String(filePath || '').split(/[\\/]/).pop() || String(filePath || 'replacement file');
}

function findLayerById(doc: any, layerId: number): any {
    const walk = (layers: any[]): any => {
        for (const layer of layers || []) {
            if (Number(layer?.id) === Number(layerId)) {
                return layer;
            }
            if (Array.isArray(layer?.layers)) {
                const found = walk(layer.layers);
                if (found) {
                    return found;
                }
            }
        }
        return null;
    };

    return walk(doc?.layers || []);
}

function getTargetLayer(doc: any, layerId?: number): any {
    if (isPositiveNumber(layerId)) {
        return findLayerById(doc, layerId);
    }
    return doc?.activeLayers?.[0] || null;
}

function getLayerKind(layer: any): string {
    return String(layer?.kind?.toString?.() || layer?.kind || '').trim().toLowerCase();
}

function isSmartObjectLayer(layer: any): boolean {
    const kind = getLayerKind(layer);
    return kind.includes('smart');
}

function getNativeRasterizeBlockedReason(): string {
    return 'rasterizeSmartObject 暂时禁用 Photoshop 原生 rasterizeLayer 写入：当前通道已观察到“栅格化当前不可用”原生弹窗风险。后续需要先实现无弹窗的可验证栅格化路径。';
}

async function canAttemptRasterizeSmartObject(layer: any): Promise<{ ok: boolean; reason?: string }> {
    const layerId = Number(layer?.id || 0);
    if (!isPositiveNumber(layerId)) {
        return { ok: false, reason: 'Rasterize requires a valid Smart Object layer id' };
    }
    if (!isSmartObjectLayer(layer)) {
        return { ok: false, reason: 'Rasterize target is not a Smart Object layer' };
    }
    if (layer?.locked === true || layer?.allLocked === true) {
        return { ok: false, reason: 'Rasterize target layer is locked' };
    }

    try {
        const result = await action.batchPlay([
            {
                _obj: 'get',
                _target: [
                    { _property: 'smartObject' },
                    { _ref: 'layer', _id: layerId }
                ],
                _options: { dialogOptions: 'dontDisplay' }
            }
        ], { synchronousExecution: true });
        const smartObjectInfo = result?.[0]?.smartObject;
        if (!smartObjectInfo || typeof smartObjectInfo !== 'object') {
            return { ok: false, reason: 'Rasterize target does not expose Smart Object metadata' };
        }
    } catch {
        return { ok: false, reason: 'Rasterize target Smart Object metadata is not readable' };
    }

    return { ok: false, reason: getNativeRasterizeBlockedReason() };
}

function normalizeBounds(bounds: any) {
    const left = Number(bounds?.left || 0);
    const top = Number(bounds?.top || 0);
    const right = Number(bounds?.right || 0);
    const bottom = Number(bounds?.bottom || 0);
    return {
        left,
        top,
        right,
        bottom,
        width: right - left,
        height: bottom - top
    };
}

function failure(toolName: string, error: unknown, params?: unknown): SmartObjectToolResult {
    return createToolFailureResult({ toolName, error, params }) as SmartObjectToolResult;
}

async function selectLayer(docId: number, layerId: number): Promise<void> {
    await action.batchPlay([
        {
            _obj: 'select',
            _target: [{ _ref: 'layer', _id: layerId }],
            makeVisible: false,
            layerID: [layerId],
            _options: { dialogOptions: 'dontDisplay' }
        }
    ], { synchronousExecution: true });
}

async function selectLayers(docId: number, layerIds: number[]): Promise<void> {
    const validIds = layerIds.filter(id => isPositiveNumber(id));
    if (!validIds.length) {
        throw new Error('No valid layerIds were provided');
    }

    if (validIds.length === 1) {
        await selectLayer(docId, validIds[0]);
        return;
    }

    await action.batchPlay([
        {
            _obj: 'select',
            _target: validIds.map(id => ({ _ref: 'layer', _id: id })),
            makeVisible: false,
            layerID: validIds,
            _options: { dialogOptions: 'dontDisplay' }
        }
    ], { synchronousExecution: true });
}

async function resolveLocalFile(filePath: string): Promise<any> {
    const fs = storage.localFileSystem;
    const normalized = String(filePath || '').trim();
    if (!normalized) {
        throw new Error('filePath is required');
    }

    const fileUrl = `file://${normalized.replace(/\\/g, '/')}`;
    try {
        return await fs.getEntryWithUrl(fileUrl);
    } catch {
        return await fs.getEntryWithUrl(normalized);
    }
}

async function createLocalFileToken(file: any): Promise<string> {
    return storage.localFileSystem.createSessionToken(file);
}

function extractLayerHierarchy(layers: any[]): any[] {
    return (layers || []).map((layer: any) => ({
        id: Number(layer?.id || 0),
        name: String(layer?.name || ''),
        kind: getLayerKind(layer),
        visible: layer?.visible !== false,
        opacity: typeof layer?.opacity === 'number' ? layer.opacity : undefined,
        bounds: layer?.bounds ? normalizeBounds(layer.bounds) : undefined,
        children: Array.isArray(layer?.layers) ? extractLayerHierarchy(layer.layers) : undefined
    }));
}

function countLayers(layers: any[]): number {
    return (layers || []).reduce((total, layer) => {
        const children = Array.isArray(layer?.children) ? countLayers(layer.children) : 0;
        return total + 1 + children;
    }, 0);
}

function buildSmartObjectSummary(doc: any, layer: any, extras: Record<string, any> = {}): SmartObjectToolResult {
    return {
        success: true,
        entityType: 'smart-object',
        documentId: Number(doc?.id || 0),
        layerId: Number(layer?.id || 0),
        name: String(layer?.name || ''),
        bounds: layer?.bounds ? normalizeBounds(layer.bounds) : undefined,
        ...extras
    };
}

function getActiveLayerIds(doc: any): number[] {
    return (doc?.activeLayers || [])
        .map((layer: any) => Number(layer?.id || 0))
        .filter((id: number) => id > 0);
}

async function ensureLayerSelection(doc: any, layerIds: number[]): Promise<void> {
    const validIds = layerIds.filter(id => isPositiveNumber(id));
    if (!validIds.length) {
        throw new Error('No valid layerIds were provided');
    }

    const currentIds = getActiveLayerIds(doc);
    if (currentIds.length === validIds.length && currentIds.every((id, index) => id === validIds[index])) {
        return;
    }

    await selectLayers(Number(doc.id), validIds);
}

export class GetSmartObjectInfoTool implements Tool {
    name = 'getSmartObjectInfo';

    schema: ToolSchema = {
        name: 'getSmartObjectInfo',
        description: 'Get Smart Object metadata such as link state, bounds, and source references.',
        parameters: {
            type: 'object',
            properties: {
                layerId: {
                    type: 'number',
                    description: 'Optional Smart Object layer id. Uses the active layer when omitted.'
                }
            },
            required: []
        }
    };

    async execute(params: { layerId?: number }): Promise<SmartObjectToolResult> {
        const doc = app.activeDocument;
        if (!doc) {
            return failure(this.name, 'No active document', params);
        }

        try {
            const layer = getTargetLayer(doc, params.layerId);
            if (!layer) {
                return failure(this.name, 'Smart Object layer not found', params);
            }
            if (!isSmartObjectLayer(layer)) {
                return failure(
                    this.name,
                    `Layer "${String(layer.name || '')}" is not a Smart Object`,
                    { ...params, layerId: Number(layer.id), kind: getLayerKind(layer) }
                );
            }

            const result = await action.batchPlay([
                {
                    _obj: 'get',
                    _target: [
                        { _ref: 'layer', _id: Number(layer.id) },
                        { _ref: 'document', _id: Number(doc.id) }
                    ],
                    _options: { dialogOptions: 'dontDisplay' }
                }
            ], { synchronousExecution: true });

            const layerInfo = result?.[0] || {};
            const smartObject = layerInfo.smartObject || {};
            const smartObjectMore = layerInfo.smartObjectMore || {};
            const summary = buildSmartObjectSummary(doc, layer, {
                isSmartObject: true,
                kind: getLayerKind(layer),
                linked: Boolean(smartObject.linked),
                fileReference: smartObject.fileReference || null,
                sourceDocumentId: smartObject.documentID ?? null,
                originalResolution: smartObject.resolution?._value ?? smartObject.resolution ?? null,
                transform: smartObjectMore.size ? {
                    width: smartObjectMore.size?.width?._value ?? smartObjectMore.size?.width ?? null,
                    height: smartObjectMore.size?.height?._value ?? smartObjectMore.size?.height ?? null,
                    resolution: smartObjectMore.resolution?._value ?? smartObjectMore.resolution ?? null
                } : null,
                message: `Read Smart Object info for "${String(layer.name || '')}".`
            });

            summary.data = {
                layerId: summary.layerId,
                layerName: summary.name,
                isSmartObject: true,
                linked: summary.linked,
                fileReference: summary.fileReference,
                bounds: summary.bounds,
                originalResolution: summary.originalResolution,
                sourceDocumentId: summary.sourceDocumentId,
                transform: summary.transform
            };

            return summary;
        } catch (error: any) {
            console.error('[GetSmartObjectInfo] Error:', error);
            return failure(this.name, error, params);
        }
    }
}

export class ConvertToSmartObjectTool implements Tool {
    name = 'convertToSmartObject';

    schema: ToolSchema = {
        name: 'convertToSmartObject',
        description: 'Convert the active layer or explicit layerIds into a Smart Object.',
        parameters: {
            type: 'object',
            properties: {
                layerIds: {
                    type: 'array',
                    description: 'Optional layer id list to convert. Uses current selection when omitted.',
                    items: { type: 'number' }
                },
                name: {
                    type: 'string',
                    description: 'Optional name to apply after conversion.'
                }
            },
            required: []
        }
    };

    async execute(params: { layerIds?: number[]; name?: string }): Promise<SmartObjectToolResult> {
        const doc = app.activeDocument;
        if (!doc) {
            return failure(this.name, 'No active document', params);
        }

        try {
            const requestedLayerIds = Array.isArray(params.layerIds)
                ? params.layerIds.filter(id => isPositiveNumber(id))
                : [];
            const sourceLayers = requestedLayerIds.length
                ? requestedLayerIds.map(id => findLayerById(doc, id)).filter(Boolean)
                : (doc.activeLayers || []).filter(Boolean);
            const sourceLayerSnapshot = sourceLayers.map((layer: any) => ({
                id: Number(layer?.id || 0),
                name: String(layer?.name || '')
            }));

            if (!sourceLayerSnapshot.length) {
                return failure(this.name, 'No source layers available for Smart Object conversion', params);
            }

            let convertedLayer: any = null;
            await executeAsModal(async () => {
                if (requestedLayerIds.length) {
                    await ensureLayerSelection(app.activeDocument, requestedLayerIds);
                }

                await action.batchPlay([
                    {
                        _obj: 'newPlacedLayer',
                        _isCommand: true,
                        _options: { dialogOptions: 'dontDisplay' }
                    }
                ], { synchronousExecution: true });

                convertedLayer = app.activeDocument?.activeLayers?.[0] || null;
                if (!convertedLayer) {
                    throw new Error('Unable to read converted Smart Object layer');
                }

                if (isNonEmptyString(params.name)) {
                    await action.batchPlay([
                        {
                            _obj: 'set',
                            _target: [{ _ref: 'layer', _id: Number(convertedLayer.id) }],
                            to: {
                                _obj: 'layer',
                                name: params.name.trim()
                            },
                            _options: { dialogOptions: 'dontDisplay' }
                        }
                    ], { synchronousExecution: true });
                    convertedLayer = app.activeDocument?.activeLayers?.[0] || convertedLayer;
                }
            }, { commandName: 'DesignEcho: Convert To Smart Object' });

            if (!convertedLayer || !isSmartObjectLayer(convertedLayer)) {
                return failure(this.name, 'Smart Object conversion did not produce a Smart Object layer', params);
            }

            const result = buildSmartObjectSummary(doc, convertedLayer, {
                sourceLayerIds: sourceLayerSnapshot.map((layer: any) => Number(layer.id)),
                sourceLayerNames: sourceLayerSnapshot.map((layer: any) => String(layer.name || '')),
                isSmartObject: true,
                message: `Converted ${sourceLayerSnapshot.length} layer(s) to Smart Object "${String(convertedLayer.name || '')}".`
            });
            result.data = {
                layerId: result.layerId,
                layerName: result.name,
                isSmartObject: true,
                sourceLayerIds: result.sourceLayerIds,
                sourceLayerNames: result.sourceLayerNames,
                bounds: result.bounds
            };
            return result;
        } catch (error: any) {
            console.error('[ConvertToSmartObject] Error:', error);
            return failure(this.name, error, params);
        }
    }
}

export class EditSmartObjectContentsTool implements Tool {
    name = 'editSmartObjectContents';

    schema: ToolSchema = {
        name: 'editSmartObjectContents',
        description: 'Open the contents of a Smart Object for editing.',
        parameters: {
            type: 'object',
            properties: {
                layerId: {
                    type: 'number',
                    description: 'Optional Smart Object layer id. Uses the active layer when omitted.'
                }
            },
            required: []
        }
    };

    async execute(params: { layerId?: number }): Promise<SmartObjectToolResult> {
        const doc = app.activeDocument;
        if (!doc) {
            return failure(this.name, 'No active document', params);
        }

        try {
            const layer = getTargetLayer(doc, params.layerId);
            if (!layer || !isSmartObjectLayer(layer)) {
                return failure(this.name, 'Smart Object layer not found', params);
            }

            let openedDoc: any = null;
            await executeAsModal(async () => {
                await ensureLayerSelection(app.activeDocument, [Number(layer.id)]);
                await action.batchPlay([
                    {
                        _obj: 'placedLayerEditContents',
                        _options: { dialogOptions: 'dontDisplay' }
                    }
                ], { synchronousExecution: true });
                openedDoc = app.activeDocument;
            }, { commandName: 'DesignEcho: Edit Smart Object Contents' });

            return {
                success: true,
                entityType: 'smart-object-document',
                documentId: Number(openedDoc?.id || 0),
                layerId: Number(layer.id),
                name: String(openedDoc?.name || layer.name || ''),
                sourceDocumentId: Number(doc.id),
                sourceLayerId: Number(layer.id),
                message: `Opened Smart Object contents for "${String(layer.name || '')}".`
            };
        } catch (error: any) {
            console.error('[EditSmartObjectContents] Error:', error);
            return failure(this.name, error, params);
        }
    }
}

export class ReplaceSmartObjectContentsTool implements Tool {
    name = 'replaceSmartObjectContents';

    schema: ToolSchema = {
        name: 'replaceSmartObjectContents',
        description: 'Replace the file contents of a Smart Object layer.',
        parameters: {
            type: 'object',
            properties: {
                layerId: {
                    type: 'number',
                    description: 'Optional Smart Object layer id. Uses the active layer when omitted.'
                },
                filePath: {
                    type: 'string',
                    description: 'Local file path to place into the Smart Object.'
                }
            },
            required: ['filePath']
        }
    };

    async execute(params: { layerId?: number; filePath: string }): Promise<SmartObjectToolResult> {
        const doc = app.activeDocument;
        if (!doc) {
            return failure(this.name, 'No active document', params);
        }
        if (!isNonEmptyString(params.filePath)) {
            return failure(this.name, 'filePath is required', params);
        }

        try {
            const layer = getTargetLayer(doc, params.layerId);
            if (!layer || !isSmartObjectLayer(layer)) {
                return failure(this.name, 'Smart Object layer not found', params);
            }
            const file = await resolveLocalFile(params.filePath);
            const fileLabel = String(file?.nativePath || params.filePath || '');
            const replacementBytes = await readFileEntryBytes(file, storage);
            assertImageBytesSafeForPhotoshop(replacementBytes, {
                formatHint: extensionFromPath(fileLabel),
                sourceLabel: `Smart Object 替换文件「${basenameFromPath(fileLabel)}」`
            });
            const fileToken = await createLocalFileToken(file);

            await executeAsModal(async () => {
                await ensureLayerSelection(app.activeDocument, [Number(layer.id)]);
                await action.batchPlay([
                    {
                        _obj: 'placedLayerReplaceContents',
                        null: {
                            _path: fileToken,
                            _kind: 'local'
                        },
                        _options: { dialogOptions: 'dontDisplay' }
                    }
                ], { synchronousExecution: true });
            }, { commandName: 'DesignEcho: Replace Smart Object Contents' });

            const refreshedLayer = getTargetLayer(app.activeDocument, Number(layer.id)) || layer;
            const result = buildSmartObjectSummary(doc, refreshedLayer, {
                replacedWith: file.nativePath,
                isSmartObject: true,
                message: `Replaced Smart Object contents for "${String(layer.name || '')}".`
            });
            result.data = {
                layerId: result.layerId,
                layerName: result.name,
                filePath: result.replacedWith,
                bounds: result.bounds
            };
            return result;
        } catch (error: any) {
            console.error('[ReplaceSmartObjectContents] Error:', error);
            return failure(this.name, error, params);
        }
    }
}

export class UpdateSmartObjectTool implements Tool {
    name = 'updateSmartObject';

    schema: ToolSchema = {
        name: 'updateSmartObject',
        description: 'Refresh or relink a Smart Object layer.',
        parameters: {
            type: 'object',
            properties: {
                layerId: {
                    type: 'number',
                    description: 'Optional Smart Object layer id. Uses the active layer when omitted.'
                },
                filePath: {
                    type: 'string',
                    description: 'Optional local file path to relink the Smart Object.'
                }
            },
            required: []
        }
    };

    async execute(params: { layerId?: number; filePath?: string }): Promise<SmartObjectToolResult> {
        const doc = app.activeDocument;
        if (!doc) {
            return failure(this.name, 'No active document', params);
        }

        try {
            const layer = getTargetLayer(doc, params.layerId);
            if (!layer || !isSmartObjectLayer(layer)) {
                return failure(this.name, 'Smart Object layer not found', params);
            }

            await executeAsModal(async () => {
                await ensureLayerSelection(app.activeDocument, [Number(layer.id)]);
                if (isNonEmptyString(params.filePath)) {
                    const file = await resolveLocalFile(params.filePath);
                    const fileToken = await createLocalFileToken(file);
                    await action.batchPlay([
                        {
                            _obj: 'placedLayerRelinkToFile',
                            null: {
                                _path: fileToken,
                                _kind: 'local'
                            },
                            _options: { dialogOptions: 'dontDisplay' }
                        }
                    ], { synchronousExecution: true });
                } else {
                    await action.batchPlay([
                        {
                            _obj: 'placedLayerUpdateModified',
                            _options: { dialogOptions: 'dontDisplay' }
                        }
                    ], { synchronousExecution: true });
                }
            }, { commandName: 'DesignEcho: Update Smart Object' });

            const refreshedLayer = getTargetLayer(app.activeDocument, Number(layer.id)) || layer;
            const result = buildSmartObjectSummary(doc, refreshedLayer, {
                relinkedTo: isNonEmptyString(params.filePath) ? params.filePath : null,
                isSmartObject: true,
                message: isNonEmptyString(params.filePath)
                    ? `Relinked Smart Object "${String(layer.name || '')}".`
                    : `Updated Smart Object "${String(layer.name || '')}".`
            });
            result.data = {
                layerId: result.layerId,
                layerName: result.name,
                relinkedTo: result.relinkedTo,
                bounds: result.bounds
            };
            return result;
        } catch (error: any) {
            console.error('[UpdateSmartObject] Error:', error);
            return failure(this.name, error, params);
        }
    }
}

export class GetSmartObjectLayersTool implements Tool {
    name = 'getSmartObjectLayers';

    schema: ToolSchema = {
        name: 'getSmartObjectLayers',
        description: 'Inspect Smart Object internal layers. Use autoOpen=false for guidance without opening another document.',
        parameters: {
            type: 'object',
            properties: {
                layerId: {
                    type: 'number',
                    description: 'Optional Smart Object layer id. Uses the active layer when omitted.'
                },
                autoOpen: {
                    type: 'boolean',
                    description: 'Open the Smart Object contents document to inspect its internal layers. Default false.'
                }
            },
            required: []
        }
    };

    async execute(params: { layerId?: number; autoOpen?: boolean }): Promise<SmartObjectToolResult> {
        const doc = app.activeDocument;
        if (!doc) {
            return failure(this.name, 'No active document', params);
        }

        try {
            const layer = getTargetLayer(doc, params.layerId);
            if (!layer || !isSmartObjectLayer(layer)) {
                return failure(this.name, 'Smart Object layer not found', params);
            }

            const autoOpen = params.autoOpen === true;
            if (!autoOpen) {
                return {
                    success: true,
                    entityType: 'smart-object-layers',
                    documentId: Number(doc.id),
                    layerId: Number(layer.id),
                    name: String(layer.name || ''),
                    autoOpen: false,
                    internalLayers: [],
                    layerCount: 0,
                    message: `Smart Object "${String(layer.name || '')}" is ready for inspection. Re-run with autoOpen=true to inspect internal layers.`
                };
            }

            let internalDoc: any = null;
            await executeAsModal(async () => {
                await ensureLayerSelection(app.activeDocument, [Number(layer.id)]);
                await action.batchPlay([
                    {
                        _obj: 'placedLayerEditContents',
                        _options: { dialogOptions: 'dontDisplay' }
                    }
                ], { synchronousExecution: true });
                internalDoc = app.activeDocument;
            }, { commandName: 'DesignEcho: Inspect Smart Object Layers' });

            if (!internalDoc || Number(internalDoc.id) === Number(doc.id)) {
                throw new Error('Unable to open Smart Object contents document');
            }

            const internalLayers = extractLayerHierarchy(internalDoc.layers || []);
            return {
                success: true,
                entityType: 'smart-object-layers',
                documentId: Number(doc.id),
                layerId: Number(layer.id),
                name: String(layer.name || ''),
                autoOpen: true,
                internalDocumentId: Number(internalDoc.id),
                internalDocumentName: String(internalDoc.name || ''),
                activeDocumentId: Number(internalDoc.id),
                activeDocumentName: String(internalDoc.name || ''),
                internalLayers,
                layerCount: countLayers(internalLayers),
                message: `Opened Smart Object contents for "${String(layer.name || '')}" and inspected ${countLayers(internalLayers)} internal layer(s).`
            };
        } catch (error: any) {
            console.error('[GetSmartObjectLayers] Error:', error);
            return failure(this.name, error, params);
        }
    }
}

export class DuplicateSmartObjectTool implements Tool {
    name = 'duplicateSmartObject';

    schema: ToolSchema = {
        name: 'duplicateSmartObject',
        description: 'Duplicate a Smart Object layer.',
        parameters: {
            type: 'object',
            properties: {
                layerId: {
                    type: 'number',
                    description: 'Optional Smart Object layer id. Uses the active layer when omitted.'
                },
                name: {
                    type: 'string',
                    description: 'Optional duplicate layer name.'
                }
            },
            required: []
        }
    };

    async execute(params: { layerId?: number; name?: string }): Promise<SmartObjectToolResult> {
        const doc = app.activeDocument;
        if (!doc) {
            return failure(this.name, 'No active document', params);
        }

        try {
            const layer = getTargetLayer(doc, params.layerId);
            if (!layer || !isSmartObjectLayer(layer)) {
                return failure(this.name, 'Smart Object layer not found', params);
            }

            let duplicatedLayer: any = null;
            await executeAsModal(async () => {
                await ensureLayerSelection(app.activeDocument, [Number(layer.id)]);
                await action.batchPlay([
                    {
                        _obj: 'copyToLayer',
                        _options: { dialogOptions: 'dontDisplay' }
                    }
                ], { synchronousExecution: true });
                duplicatedLayer = app.activeDocument?.activeLayers?.[0] || null;
                if (duplicatedLayer && isNonEmptyString(params.name)) {
                    await action.batchPlay([
                        {
                            _obj: 'set',
                            _target: [{ _ref: 'layer', _id: Number(duplicatedLayer.id) }],
                            to: { _obj: 'layer', name: params.name.trim() },
                            _options: { dialogOptions: 'dontDisplay' }
                        }
                    ], { synchronousExecution: true });
                    duplicatedLayer = app.activeDocument?.activeLayers?.[0] || duplicatedLayer;
                }
            }, { commandName: 'DesignEcho: Duplicate Smart Object' });

            if (!duplicatedLayer) {
                throw new Error('Unable to duplicate Smart Object layer');
            }

            const result = buildSmartObjectSummary(doc, duplicatedLayer, {
                isSmartObject: true,
                sourceLayerId: Number(layer.id),
                sourceLayerName: String(layer.name || ''),
                message: `Duplicated Smart Object "${String(layer.name || '')}".`
            });
            result.data = {
                layerId: result.layerId,
                layerName: result.name,
                sourceLayerId: result.sourceLayerId,
                sourceLayerName: result.sourceLayerName,
                bounds: result.bounds
            };
            return result;
        } catch (error: any) {
            console.error('[DuplicateSmartObject] Error:', error);
            return failure(this.name, error, params);
        }
    }
}

export class RasterizeSmartObjectTool implements Tool {
    name = 'rasterizeSmartObject';

    schema: ToolSchema = {
        name: 'rasterizeSmartObject',
        description: 'Rasterize a Smart Object layer.',
        parameters: {
            type: 'object',
            properties: {
                layerId: {
                    type: 'number',
                    description: 'Optional Smart Object layer id. Uses the active layer when omitted.'
                },
                destructiveRasterizeConfirmed: {
                    type: 'boolean',
                    description: 'Must be true to allow destructive rasterization. Default requests return a structured failure instead of calling Photoshop.'
                }
            },
            required: []
        }
    };

    async execute(params: { layerId?: number; destructiveRasterizeConfirmed?: boolean }): Promise<SmartObjectToolResult> {
        const doc = app.activeDocument;
        if (!doc) {
            return failure(this.name, 'No active document', params);
        }

        try {
            const layer = getTargetLayer(doc, params.layerId);
            if (!layer || !isSmartObjectLayer(layer)) {
                return failure(this.name, 'Smart Object layer not found', params);
            }
            if (params.destructiveRasterizeConfirmed !== true) {
                return failure(this.name, 'destructiveRasterizeConfirmed=true is required before rasterizing a Smart Object layer', params);
            }

            const rasterizeAvailability = await canAttemptRasterizeSmartObject(layer);
            if (!rasterizeAvailability.ok) {
                return failure(this.name, rasterizeAvailability.reason || 'Smart Object rasterize is not available for this layer', params);
            }
            return failure(this.name, getNativeRasterizeBlockedReason(), params);
        } catch (error: any) {
            console.error('[RasterizeSmartObject] Error:', error);
            return failure(this.name, error, params);
        }
    }
}
