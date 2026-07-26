/**
 * 模板渲染工具类
 * 
 * 在 Photoshop 中执行模板渲染操作
 */

import { app, core, action } from 'photoshop';
import { Tool, ToolSchema, ToolResult } from '../types';
import { openDocumentWithJsx } from '../../core/jsx-bridge';
import { getEntryFromPath } from '../../core/file-url';
import {
    arrayBufferFromBytes,
    assertImageBytesSafeForPhotoshop,
    bytesFromBase64ImagePayload,
    readFileEntryBytes
} from '../../core/image-safety';

// ===== 辅助函数 =====

/**
 * 根据路径查找图层
 */
async function findLayerByPath(layerPath: string): Promise<any | null> {
    const doc = app.activeDocument;
    if (!doc) return null;

    const parts = layerPath.split('/');
    let current: any = doc;

    for (const part of parts) {
        if (!current.layers) return null;
        
        const found = current.layers.find((layer: any) => {
            return layer.name === part || layer.name.includes(part);
        });

        if (!found) return null;
        current = found;
    }

    return current;
}

/**
 * 处理图层结构
 */
function processLayers(layers: any[]): any[] {
    return layers.map(layer => ({
        id: layer.id,
        name: layer.name,
        kind: layer.kind,
        visible: layer.visible,
        bounds: layer.bounds ? {
            left: layer.bounds.left,
            top: layer.bounds.top,
            right: layer.bounds.right,
            bottom: layer.bounds.bottom
        } : null,
        isPlaceholder: layer.name.startsWith('['),
        children: layer.layers ? processLayers(layer.layers) : undefined
    }));
}

function getBoundsNoEffects(layer: any): any {
    return layer?.boundsNoEffects || layer?.bounds;
}

function normalizeTargetRect(bounds: any): { left: number; top: number; right: number; bottom: number } | null {
    if (!bounds) return null;
    const left = Number(bounds.left);
    const top = Number(bounds.top);
    const right = Number(bounds.right);
    const bottom = Number(bounds.bottom);
    if (![left, top, right, bottom].every((value) => Number.isFinite(value))) {
        return null;
    }
    if (right <= left || bottom <= top) {
        return null;
    }
    return { left, top, right, bottom };
}

function normalizePlacementBox(box: any): { x: number; y: number; width: number; height: number } | null {
    if (!box) return null;
    const x = Number(box.x);
    const y = Number(box.y);
    const width = Number(box.width);
    const height = Number(box.height);
    if (![x, y, width, height].every((value) => Number.isFinite(value))) {
        return null;
    }
    if (width <= 0 || height <= 0) {
        return null;
    }
    return { x, y, width, height };
}

function placementBoxToRect(box: { x: number; y: number; width: number; height: number }): { left: number; top: number; right: number; bottom: number } {
    return {
        left: box.x,
        top: box.y,
        right: box.x + box.width,
        bottom: box.y + box.height
    };
}

function rectContains(
    outer: { left: number; top: number; right: number; bottom: number },
    inner: { left: number; top: number; right: number; bottom: number }
): boolean {
    return inner.left >= outer.left
        && inner.top >= outer.top
        && inner.right <= outer.right
        && inner.bottom <= outer.bottom;
}

function rectWithSize(rect: { left: number; top: number; right: number; bottom: number }): { left: number; top: number; right: number; bottom: number; width: number; height: number } {
    return {
        ...rect,
        width: Math.max(1, rect.right - rect.left),
        height: Math.max(1, rect.bottom - rect.top)
    };
}

function statusFromPlacementDeviation(maxAbs: number): 'ok' | 'watch' | 'mismatch' {
    if (maxAbs <= 2) return 'ok';
    if (maxAbs <= 8) return 'watch';
    return 'mismatch';
}

function buildPlacementAudit(
    strategy: 'placementTransform' | 'smartScalingDecision' | 'fitFallback',
    plannedRect: { left: number; top: number; right: number; bottom: number } | null,
    actualRect: { left: number; top: number; right: number; bottom: number } | null,
    smartScalingDecision?: {
        confidence?: number;
        cropRisk?: string;
        warnings?: string[];
    }
) {
    if (!plannedRect || !actualRect) {
        return {
            strategy,
            status: 'unverified',
            smartScaling: smartScalingDecision
                ? {
                    confidence: Number(smartScalingDecision.confidence || 0) || undefined,
                    cropRisk: smartScalingDecision.cropRisk,
                    warnings: smartScalingDecision.warnings || []
                }
                : undefined,
            notes: ['missing planned or actual bounds for verification']
        };
    }

    const planned = rectWithSize(plannedRect);
    const actual = rectWithSize(actualRect);
    const deviation = {
        left: actual.left - planned.left,
        top: actual.top - planned.top,
        width: actual.width - planned.width,
        height: actual.height - planned.height,
        maxAbs: 0
    };
    deviation.maxAbs = Math.max(
        Math.abs(deviation.left),
        Math.abs(deviation.top),
        Math.abs(deviation.width),
        Math.abs(deviation.height)
    );

    return {
        strategy,
        plannedBounds: planned,
        actualBounds: actual,
        deviation,
        status: statusFromPlacementDeviation(deviation.maxAbs),
        smartScaling: smartScalingDecision
            ? {
                confidence: Number(smartScalingDecision.confidence || 0) || undefined,
                cropRisk: smartScalingDecision.cropRisk,
                warnings: smartScalingDecision.warnings || []
            }
            : undefined,
        notes: [
            ...(deviation.maxAbs <= 2 ? [] : [`actual bounds deviate from planned bounds by ${deviation.maxAbs.toFixed(1)}px`]),
            ...(smartScalingDecision?.warnings || [])
        ]
    };
}

async function createSessionTokenFromPath(filePath: string): Promise<string> {
    const uxpStorage = require('uxp').storage;
    const localFs = uxpStorage.localFileSystem;
    const fileEntry = await getEntryFromPath(localFs, filePath);
    if (!fileEntry) {
        throw new Error(`Cannot access file: ${filePath}`);
    }
    return await localFs.createSessionToken(fileEntry);
}

async function createValidatedImageSessionTokenFromPath(filePath: string): Promise<string> {
    const uxpStorage = require('uxp').storage;
    const localFs = uxpStorage.localFileSystem;
    const fileEntry = await getEntryFromPath(localFs, filePath);
    if (!fileEntry) {
        throw new Error(`Cannot access image file: ${filePath}`);
    }
    const bytes = await readFileEntryBytes(fileEntry, uxpStorage);
    const extension = String(filePath.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
    assertImageBytesSafeForPhotoshop(bytes, {
        formatHint: extension,
        sourceLabel: `占位图文件「${filePath.split(/[\\/]/).pop() || filePath}」`
    });
    return await localFs.createSessionToken(fileEntry);
}

function findLayerById(container: any, layerId: number): any | null {
    const layers = Array.isArray(container?.layers) ? container.layers : [];
    for (const layer of layers) {
        if (layer?.id === layerId) return layer;
        const nested = findLayerById(layer, layerId);
        if (nested) return nested;
    }
    return null;
}

function extensionFromMimeType(mimeType: string): string {
    const normalized = String(mimeType || '').toLowerCase();
    if (normalized.includes('jpeg') || normalized.includes('jpg')) return 'jpg';
    if (normalized.includes('webp')) return 'webp';
    return 'png';
}

function describeUnknownError(error: unknown): string {
    if (error === null || error === undefined) {
        return 'Unknown error';
    }
    if (error instanceof Error) {
        return error.message || error.name;
    }
    if (typeof error === 'string') {
        return error;
    }
    try {
        const serialized = JSON.stringify(error);
        if (typeof serialized === 'string' && serialized.trim()) {
            return serialized;
        }
    } catch {
        // fall through to String(error)
    }
    const stringified = String(error);
    return stringified && stringified !== 'undefined' ? stringified : 'Unknown error';
}

async function createSessionTokenFromImagePayload(input: string): Promise<string> {
    const { bytes, mimeType } = bytesFromBase64ImagePayload(input);
    assertImageBytesSafeForPhotoshop(bytes, {
        formatHint: mimeType,
        sourceLabel: '占位图 Base64 图片'
    });

    const uxpStorage = require('uxp').storage;
    const localFs = uxpStorage.localFileSystem;
    const tempFolder = await localFs.getTemporaryFolder();
    const tempFile = await tempFolder.createFile(`placeholder_${Date.now()}.${extensionFromMimeType(mimeType)}`, {
        overwrite: true
    });
    await tempFile.write(arrayBufferFromBytes(bytes), { format: uxpStorage.formats.binary });
    return await localFs.createSessionToken(tempFile);
}

// ===== 打开 PSD/PSB 文件 =====
// 注意：此工具可用于打开任何 PSD/PSB 文件，包括 SKU 素材、模板、详情页等

export class OpenTemplateTool implements Tool {
    name = 'openTemplate';  // 保持向后兼容，实际可打开任意 PSD/PSB
    
    schema: ToolSchema = {
        name: 'openTemplate',
        description: '打开 PSD/PSB 文件（可以是模板、SKU 素材、详情页等任意设计文件）',
        parameters: {
            type: 'object',
            properties: {
                psdPath: {
                    type: 'string',
                    description: 'PSD/PSB 文件的完整路径'
                }
            },
            required: ['psdPath']
        }
    };

    async execute(params: { psdPath: string; fileToken?: string }): Promise<ToolResult> {
        const { psdPath, fileToken: providedFileToken } = params;
        
        console.log('[OpenFile] 开始打开文件:', psdPath);

        if (!psdPath) {
            return {
                success: false,
                error: '未提供文件路径',
                data: null
            };
        }

        try {
            const fileName = psdPath.split(/[\\\/]/).pop() || 'file.psd';

            let fileToken: string | undefined = providedFileToken;
            if (!fileToken) {
            try {
                fileToken = await createSessionTokenFromPath(psdPath);
                console.log('[OpenFile] 已通过路径直接获取文件 token');
            } catch (directOpenError: any) {
                console.warn('[OpenFile] 直接路径访问失败，回退到文件选择器:', directOpenError?.message || directOpenError);
            }
            }

            if (!fileToken) {
                try {
                    const jsxResult = await openDocumentWithJsx(psdPath);
                    const activeDocument = app.activeDocument;
                    return {
                        success: true,
                        data: {
                            message: `文件已打开: ${jsxResult.documentName}`,
                            documentName: jsxResult.documentName,
                            documentId: Number(activeDocument?.id || 0),
                            activeDocumentId: Number(activeDocument?.id || 0),
                            activeDocumentName: String(activeDocument?.name || jsxResult.documentName || ''),
                            filePath: jsxResult.filePath,
                            openedVia: 'jsx'
                        }
                    };
                } catch (jsxError) {
                    console.warn('[OpenFile] JSX fallback open failed:', jsxError);
                }

                return {
                    success: false,
                    error: `无法直接打开文件: ${psdPath}`,
                    data: {
                        suggestion: 'direct_open_failed',
                        filePath: psdPath,
                        fileName
                    }
                };

                const uxpStorage = require('uxp').storage;
                const localFs = uxpStorage.localFileSystem as any;
                console.log('[OpenFile] 尝试通过文件选择器获取访问权限...');

                let fileEntry;
                try {
                    fileEntry = await localFs.getFileForOpening({
                        types: ['psd', 'psb']
                    });

                    if (!fileEntry) {
                        console.log('[OpenFile] 用户取消了文件选择');
                        return {
                            success: false,
                            error: `用户取消了文件选择。\n\n如需打开文件，请在 Photoshop 中使用 **文件 > 打开**:\n📁 ${psdPath}`,
                            data: {
                                suggestion: 'manual_open',
                                filePath: psdPath,
                                fileName: fileName
                            }
                        };
                    }

                    console.log('[OpenFile] 用户选择了文件:', fileEntry.name);
                    fileToken = await localFs.createSessionToken(fileEntry);
                } catch (pickerError: any) {
                    console.error('[OpenFile] 文件选择器失败:', pickerError.message);

                    return {
                        success: false,
                        error: `⚠️ 无法自动打开文件。\n\n请在 Photoshop 中手动打开:\n📁 ${psdPath}`,
                        data: {
                            suggestion: 'manual_open',
                            filePath: psdPath,
                            fileName: fileName
                        }
                    };
                }
            }

            // 使用 token 打开文件
            await core.executeAsModal(async () => {
                await action.batchPlay([
                    {
                        _obj: 'open',
                        null: {
                            _path: fileToken,
                            _kind: 'local'
                        },
                        _options: { dialogOptions: 'dontDisplay' }
                    }
                ], { synchronousExecution: true });
            }, { commandName: `打开文件: ${fileName}` });

            const docName = app.activeDocument?.name;
            console.log('[OpenFile] 打开成功，当前文档:', docName);
            
            return {
                success: true,
                data: {
                    message: `文件已打开: ${docName || fileName}`,
                    documentName: docName,
                    documentId: Number(app.activeDocument?.id || 0),
                    activeDocumentId: Number(app.activeDocument?.id || 0),
                    activeDocumentName: String(docName || fileName),
                    filePath: psdPath
                }
            };
        } catch (error: any) {
            console.error('[OpenFile] 打开失败:', error);
            
            // 提取文件名用于显示
            const fileName = psdPath.split(/[\\\/]/).pop() || 'file.psd';

            try {
                const jsxResult = await openDocumentWithJsx(psdPath);
                const activeDocument = app.activeDocument;
                return {
                    success: true,
                    data: {
                        message: `文件已打开: ${jsxResult.documentName}`,
                        documentName: jsxResult.documentName,
                        documentId: Number(activeDocument?.id || 0),
                        activeDocumentId: Number(activeDocument?.id || 0),
                        activeDocumentName: String(activeDocument?.name || jsxResult.documentName || ''),
                        filePath: jsxResult.filePath,
                        openedVia: 'jsx'
                    }
                };
            } catch (jsxError) {
                console.warn('[OpenFile] JSX fallback after batchPlay failure also failed:', jsxError);
            }
            
            return {
                success: false,
                error: `⚠️ 无法自动打开文件。\n\n请在 Photoshop 中手动打开:\n📁 ${psdPath}`,
                data: {
                    suggestion: 'manual_open',
                    filePath: psdPath,
                    fileName: fileName
                }
            };
        }
    }
}

// ===== 获取图层结构 =====

export class GetTemplateStructureTool implements Tool {
    name = 'getTemplateStructure';
    
    schema: ToolSchema = {
        name: 'getTemplateStructure',
        description: '获取当前文档的图层结构，用于分析模板占位符',
        parameters: {
            type: 'object',
            properties: {},
            required: []
        }
    };

    async execute(_params: object): Promise<ToolResult> {
        const doc = app.activeDocument;
        if (!doc) {
            return {
                success: false,
                error: '没有打开的文档',
                data: null
            };
        }

        const placeholders: any[] = [];

        function scanForPlaceholders(layers: any[], path: string = '') {
            for (const layer of layers) {
                const currentPath = path ? `${path}/${layer.name}` : layer.name;
                
                if (layer.name.startsWith('[')) {
                    placeholders.push({
                        name: layer.name,
                        path: currentPath,
                        kind: layer.kind,
                        visible: layer.visible
                    });
                }
                
                if (layer.layers) {
                    scanForPlaceholders(layer.layers, currentPath);
                }
            }
        }

        scanForPlaceholders(doc.layers);

        return {
            success: true,
            data: {
                message: `文档包含 ${placeholders.length} 个占位符`,
                documentName: doc.name,
                width: doc.width,
                height: doc.height,
                placeholders,
                layers: processLayers(doc.layers)
            }
        };
    }
}

// ===== 替换图片占位符 =====

export class ReplaceImagePlaceholderTool implements Tool {
    name = 'replaceImagePlaceholder';
    
    schema: ToolSchema = {
        name: 'replaceImagePlaceholder',
        description: 'Replace an image placeholder using a layer path or explicit layer id.',
        parameters: {
            type: 'object',
            properties: {
                layerPath: {
                    type: 'string',
                    description: 'Target layer path, for example "Product/[IMG:hero]"'
                },
                placeholderLayerId: {
                    type: 'number',
                    description: 'Explicit placeholder layer id'
                },
                targetLayerId: {
                    type: 'number',
                    description: 'Alias for explicit placeholder layer id'
                },
                imagePath: {
                    type: 'string',
                    description: 'Absolute image path to place'
                },
                imageBase64: {
                    type: 'string',
                    description: 'Base64 image payload or data URL'
                },
                image: {
                    type: 'string',
                    description: 'Alias for imageBase64'
                },
                fit: {
                    type: 'string',
                    enum: ['contain', 'cover', 'fill', 'none'],
                    description: 'Image fit mode'
                },
                align: {
                    type: 'string',
                    enum: ['center', 'top', 'bottom', 'left', 'right'],
                    description: 'Alignment inside the placeholder bounds'
                },
                targetBounds: {
                    type: 'object',
                    description: 'Optional explicit target bounds override'
                },
                placementTransform: {
                    type: 'object',
                    description: 'Optional placement transform metadata'
                },
                smartScalingDecision: {
                    type: 'object',
                    description: 'Optional smart scaling decision metadata'
                }
            },
            required: []
        }
    };

    async execute(params: {
        layerPath?: string;
        placeholderLayerId?: number;
        targetLayerId?: number;
        imagePath?: string;
        imageBase64?: string;
        image?: string;
        fit?: string;
        align?: string;
        targetBounds?: { left?: number; top?: number; right?: number; bottom?: number };
        placementTransform?: {
            destinationBox?: { x?: number; y?: number; width?: number; height?: number };
            visibleBox?: { x?: number; y?: number; width?: number; height?: number };
            scale?: number;
            scaleX?: number;
            scaleY?: number;
            anchor?: string;
            scaleMode?: string;
            cropRisk?: boolean;
        };
        smartScalingDecision?: {
            destinationBox?: { x?: number; y?: number; width?: number; height?: number };
            confidence?: number;
            cropRisk?: string;
            warnings?: string[];
        };
    }): Promise<any> {
        const doc = app.activeDocument;
        if (!doc) {
            return { success: false, error: 'No active document' };
        }

        const explicitLayerId = typeof params.placeholderLayerId === 'number'
            ? params.placeholderLayerId
            : typeof params.targetLayerId === 'number'
                ? params.targetLayerId
                : undefined;
        const layerPath = String(params.layerPath || '').trim();
        const layer = typeof explicitLayerId === 'number'
            ? findLayerById(doc, explicitLayerId)
            : layerPath
                ? await findLayerByPath(layerPath)
                : null;

        if (!layer) {
            return {
                success: false,
                error: typeof explicitLayerId === 'number'
                    ? `Layer not found for id ${explicitLayerId}`
                    : 'replaceImagePlaceholder requires layerPath, placeholderLayerId, or targetLayerId'
            };
        }

        const fit = String(params.fit || 'contain');
        const align = String(params.align || 'center');
        const imagePayload = String(params.imageBase64 || params.image || '').trim();
        const imagePath = String(params.imagePath || '').trim();
        if (!imagePayload && !imagePath) {
            return {
                success: false,
                error: 'replaceImagePlaceholder requires imagePath, imageBase64, or image'
            };
        }

        let failureStage = 'start';
        try {
            let resultLayerId = Number(layer.id);
            let resultLayerName = String(layer.name || '');
            let placementAudit: ReturnType<typeof buildPlacementAudit> | null = null;
            await core.executeAsModal(async () => {
                failureStage = 'resolve-target-bounds';
                const targetBounds = normalizeTargetRect(params.targetBounds) || getBoundsNoEffects(layer);
                if (!targetBounds) {
                    throw new Error('Target layer bounds are unavailable');
                }
                const targetWidth = targetBounds.right - targetBounds.left;
                const targetHeight = targetBounds.bottom - targetBounds.top;
                if (!(targetWidth > 0) || !(targetHeight > 0)) {
                    throw new Error(`Invalid target bounds ${targetWidth}x${targetHeight}`);
                }
                const targetCenterX = targetBounds.left + targetWidth / 2;
                const targetCenterY = targetBounds.top + targetHeight / 2;

                failureStage = 'prepare-image-token';
                const imageToken = imagePayload
                    ? await createSessionTokenFromImagePayload(imagePayload)
                    : await createValidatedImageSessionTokenFromPath(imagePath);

                failureStage = 'place-image';
                await action.batchPlay([
                    {
                        _obj: 'placeEvent',
                        null: {
                            _path: imageToken,
                            _kind: 'local'
                        },
                        freeTransformCenterState: {
                            _enum: 'quadCenterState',
                            _value: 'QCSAverage'
                        },
                        _options: { dialogOptions: 'dontDisplay' }
                    }
                ], { synchronousExecution: true });

                failureStage = 'resolve-placed-layer';
                const newLayer = doc.activeLayers[0];
                if (!newLayer) {
                    throw new Error('Failed to create placed layer');
                }

                failureStage = 'measure-placed-layer';
                const newBounds = getBoundsNoEffects(newLayer);
                if (!newBounds) {
                    throw new Error('Placed layer bounds are unavailable');
                }
                const newWidth = newBounds.right - newBounds.left;
                const newHeight = newBounds.bottom - newBounds.top;
                if (!(newWidth > 0) || !(newHeight > 0)) {
                    throw new Error(`Invalid placed layer bounds ${newWidth}x${newHeight}`);
                }

                const transformDestination = normalizePlacementBox(params.placementTransform?.destinationBox);
                const transformVisible = normalizePlacementBox(params.placementTransform?.visibleBox);
                const smartScalingDestination = normalizePlacementBox(params.smartScalingDecision?.destinationBox);
                const transformDestinationRect = transformDestination ? placementBoxToRect(transformDestination) : null;
                const transformVisibleRect = transformVisible ? placementBoxToRect(transformVisible) : null;
                const smartScalingDestinationRect = smartScalingDestination ? placementBoxToRect(smartScalingDestination) : null;
                const canUseTransformDestination = !!transformDestinationRect && rectContains(targetBounds, transformDestinationRect);
                const canUseSmartScalingDestination = !canUseTransformDestination
                    && !!smartScalingDestinationRect
                    && rectContains(targetBounds, smartScalingDestinationRect);
                const destinationRect = canUseTransformDestination
                    ? transformDestinationRect
                    : canUseSmartScalingDestination
                        ? smartScalingDestinationRect
                        : null;
                const placementStrategy = canUseTransformDestination
                    ? 'placementTransform'
                    : canUseSmartScalingDestination
                        ? 'smartScalingDecision'
                        : 'fitFallback';
                const plannedRect = destinationRect
                    ? destinationRect
                    : transformVisibleRect || targetBounds;

                if (destinationRect) {
                    failureStage = 'scale-placed-layer';
                    await action.batchPlay([
                        {
                            _obj: 'transform',
                            freeTransformCenterState: {
                                _enum: 'quadCenterState',
                                _value: 'QCSAverage'
                            },
                            width: {
                                _unit: 'percentUnit',
                                _value: Math.max(1, ((destinationRect.right - destinationRect.left) / newWidth) * 100)
                            },
                            height: {
                                _unit: 'percentUnit',
                                _value: Math.max(1, ((destinationRect.bottom - destinationRect.top) / newHeight) * 100)
                            },
                            _options: { dialogOptions: 'dontDisplay' }
                        }
                    ], { synchronousExecution: true });

                    failureStage = 'align-placed-layer';
                    const currentBounds = getBoundsNoEffects(newLayer);
                    if (!currentBounds) {
                        throw new Error('Aligned layer bounds are unavailable');
                    }
                    await newLayer.translate(
                        destinationRect.left - currentBounds.left,
                        destinationRect.top - currentBounds.top
                    );
                } else {
                    let scaleX = 1;
                    let scaleY = 1;
                    const alignBounds = transformVisibleRect || targetBounds;
                    const alignWidth = alignBounds.right - alignBounds.left;
                    const alignHeight = alignBounds.bottom - alignBounds.top;
                    const alignCenterX = alignBounds.left + alignWidth / 2;
                    const alignCenterY = alignBounds.top + alignHeight / 2;

                    if (fit === 'contain') {
                        const uniform = Math.min(alignWidth / newWidth, alignHeight / newHeight);
                        scaleX = uniform;
                        scaleY = uniform;
                    } else if (fit === 'cover') {
                        const uniform = Math.max(alignWidth / newWidth, alignHeight / newHeight);
                        scaleX = uniform;
                        scaleY = uniform;
                    } else if (fit === 'fill') {
                        scaleX = alignWidth / newWidth;
                        scaleY = alignHeight / newHeight;
                    }

                    if (scaleX !== 1 || scaleY !== 1) {
                        failureStage = 'scale-placed-layer';
                        await action.batchPlay([
                            {
                                _obj: 'transform',
                                freeTransformCenterState: {
                                    _enum: 'quadCenterState',
                                    _value: 'QCSAverage'
                                },
                                width: { _unit: 'percentUnit', _value: scaleX * 100 },
                                height: { _unit: 'percentUnit', _value: scaleY * 100 },
                                _options: { dialogOptions: 'dontDisplay' }
                            }
                        ], { synchronousExecution: true });
                    }

                    failureStage = 'align-placed-layer';
                    const currentBounds = getBoundsNoEffects(newLayer);
                    if (!currentBounds) {
                        throw new Error('Aligned layer bounds are unavailable');
                    }
                    const currentWidth = currentBounds.right - currentBounds.left;
                    const currentHeight = currentBounds.bottom - currentBounds.top;
                    let desiredLeft = alignBounds.left;
                    let desiredTop = alignBounds.top;

                    if (align === 'center') {
                        desiredLeft = alignCenterX - currentWidth / 2;
                        desiredTop = alignCenterY - currentHeight / 2;
                    } else if (align === 'top') {
                        desiredLeft = alignCenterX - currentWidth / 2;
                        desiredTop = alignBounds.top;
                    } else if (align === 'bottom') {
                        desiredLeft = alignCenterX - currentWidth / 2;
                        desiredTop = alignBounds.bottom - currentHeight;
                    } else if (align === 'left') {
                        desiredLeft = alignBounds.left;
                        desiredTop = alignCenterY - currentHeight / 2;
                    } else if (align === 'right') {
                        desiredLeft = alignBounds.right - currentWidth;
                        desiredTop = alignCenterY - currentHeight / 2;
                    }

                    await newLayer.translate(
                        desiredLeft - currentBounds.left,
                        desiredTop - currentBounds.top
                    );
                }

                failureStage = 'finalize-replacement';
                const originalName = layer.name;
                await layer.delete();
                newLayer.name = originalName;
                resultLayerId = Number(newLayer.id);
                resultLayerName = String(newLayer.name || originalName || '');
                placementAudit = buildPlacementAudit(
                    placementStrategy,
                    plannedRect,
                    normalizeTargetRect(getBoundsNoEffects(newLayer)),
                    params.smartScalingDecision
                );
            }, { commandName: 'Replace Image Placeholder' });

            return {
                success: true,
                entityType: 'image-placeholder-replacement',
                documentId: Number(doc.id),
                layerId: resultLayerId,
                name: resultLayerName,
                targetLayerId: Number(layer.id),
                placementAudit,
                message: `Replaced image placeholder ${resultLayerName}`
            };
        } catch (error: unknown) {
            const detail = describeUnknownError(error);
            return {
                success: false,
                error: `Replace image placeholder failed: ${detail}`,
                stage: typeof failureStage === 'string' ? failureStage : 'unknown'
            };
        }
    }
}
export class ReplaceTextPlaceholderTool implements Tool {
    name = 'replaceTextPlaceholder';
    
    schema: ToolSchema = {
        name: 'replaceTextPlaceholder',
        description: '替换模板中的文本占位符',
        parameters: {
            type: 'object',
            properties: {
                layerPath: {
                    type: 'string',
                    description: '目标文本图层路径，如 "文字层/[TEXT:标题]"'
                },
                text: {
                    type: 'string',
                    description: '替换的文本内容'
                },
                maxLength: {
                    type: 'string',
                    description: '最大字符数，超出会截断并添加...'
                }
            },
            required: ['layerPath', 'text']
        }
    };

    async execute(params: {
        layerPath: string;
        text: string;
        maxLength?: number;
    }): Promise<ToolResult> {
        const { layerPath, text, maxLength } = params;
        
        const doc = app.activeDocument;
        if (!doc) {
            return { success: false, error: '没有打开的文档', data: null };
        }

        const layer = await findLayerByPath(layerPath);
        if (!layer) {
            return { success: false, error: `图层未找到: ${layerPath}`, data: null };
        }

        if (layer.kind !== 'text') {
            return { success: false, error: `图层 ${layerPath} 不是文本图层`, data: null };
        }

        try {
            await core.executeAsModal(async () => {
                let finalText = text;
                if (maxLength && text.length > maxLength) {
                    finalText = text.substring(0, maxLength) + '...';
                }
                layer.textItem.contents = finalText;
            }, { commandName: 'Replace Text Placeholder' });

            return {
                success: true,
                data: { 
                    message: `已替换文本: ${layerPath}`,
                    text: text.length > 50 ? text.substring(0, 50) + '...' : text 
                }
            };
        } catch (error: any) {
            return {
                success: false,
                error: `替换文本失败: ${error.message}`,
                data: null
            };
        }
    }
}

// ===== 批量渲染 =====

export class BatchRenderTemplateTool implements Tool {
    name = 'batchRenderTemplate';
    
    schema: ToolSchema = {
        name: 'batchRenderTemplate',
        description: '批量执行模板渲染指令',
        parameters: {
            type: 'object',
            properties: {
                instructions: {
                    type: 'array',
                    description: '渲染指令数组，每个指令包含 action, layerPath 和相应参数',
                    items: { type: 'object' }
                }
            },
            required: ['instructions']
        }
    };

    async execute(params: {
        instructions: Array<{
            action: string;
            layerPath: string;
            [key: string]: any;
        }>;
    }): Promise<ToolResult> {
        const { instructions } = params;

        if (!instructions || instructions.length === 0) {
            return { success: false, error: '没有渲染指令', data: null };
        }

        const doc = app.activeDocument;
        if (!doc) {
            return { success: false, error: '没有打开的文档', data: null };
        }

        const results: { action: string; layerPath: string; success: boolean; error?: string }[] = [];

        for (const instruction of instructions) {
            try {
                const layer = await findLayerByPath(instruction.layerPath);
                
                if (!layer) {
                    results.push({
                        action: instruction.action,
                        layerPath: instruction.layerPath,
                        success: false,
                        error: '图层未找到'
                    });
                    continue;
                }

                await core.executeAsModal(async () => {
                    switch (instruction.action) {
                        case 'hideLayer':
                            layer.visible = false;
                            break;
                        case 'showLayer':
                            layer.visible = true;
                            break;
                        case 'setText':
                            if (layer.kind === 'text') {
                                layer.textItem.contents = instruction.text;
                            }
                            break;
                    }
                }, { commandName: `Render: ${instruction.action}` });

                results.push({
                    action: instruction.action,
                    layerPath: instruction.layerPath,
                    success: true
                });

            } catch (error: any) {
                results.push({
                    action: instruction.action,
                    layerPath: instruction.layerPath,
                    success: false,
                    error: error.message
                });
            }
        }

        const successCount = results.filter(r => r.success).length;
        const failCount = results.filter(r => !r.success).length;

        return {
            success: failCount === 0,
            data: { 
                message: `批量渲染完成: ${successCount} 成功, ${failCount} 失败`,
                results, 
                successCount, 
                failCount 
            }
        };
    }
}
