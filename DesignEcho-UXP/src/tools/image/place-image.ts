/**
 * 置入图片工具
 * 
 * 将外部图片置入到当前 Photoshop 文档中
 * 支持从 Base64 数据或文件路径置入
 */

import { Tool, ToolExecutionContext, ToolResult, ToolSchema } from '../types';
import { getEntryFromPath } from '../../core/file-url';
import { createToolFailureResult } from '../../core/tool-error-normalizer';
import {
    arrayBufferFromBytes,
    assertImageBytesSafeForPhotoshop,
    bytesFromBase64ImagePayload,
    readFileEntryBytes
} from '../../core/image-safety';
import { getPhotoshopElementPlacement } from '../layout/photoshop-runtime-adapters';

const { app, core, action, constants } = require('photoshop');
const uxp = require('uxp');
const fs = uxp.storage.localFileSystem;
const REQUEST_CANCELLED_ERROR = 'REQUEST_CANCELLED';

function isRequestCancelled(context?: ToolExecutionContext): boolean {
    return Boolean(context?.isCancelled?.());
}

function throwIfRequestCancelled(context?: ToolExecutionContext): void {
    if (isRequestCancelled(context)) {
        const error = new Error('请求已取消');
        (error as Error & { code?: string }).code = REQUEST_CANCELLED_ERROR;
        throw error;
    }
}

function buildCancelledToolResult(): ToolResult {
    return {
        success: false,
        error: '请求已取消',
        data: {
            cancelled: true
        }
    };
}

export interface PlaceImageParams {
    /** 图片 Base64 数据 */
    imageData?: string;
    /** imageData 时的格式：png|jpeg|gif（默认 png） */
    imageFormat?: string;
    /** 图片文件路径（本地路径） */
    filePath?: string;
    /** UXP 会话文件 token（优先于 filePath） */
    fileToken?: string;
    /** 图片名称（用于图层命名） */
    name?: string;
    /** 置入位置 X */
    x?: number;
    /** 置入位置 Y */
    y?: number;
    /** 缩放百分比，默认 100；可大于 100 表示放大 */
    scale?: number;
    /** 是否居中置入 */
    center?: boolean;
    /** 是否自动调整大小以适应画布 */
    fitToCanvas?: boolean;
    /** 配合 fitToCanvas：true 时允许放大超过原始尺寸铺满画布；默认 false 只缩不放（封顶 100%） */
    allowUpscale?: boolean;
    /** 目标区域：支持 {x,y,width,height} 或 {left,top,right,bottom}；模型常把没用的字段填 null，允许 null 并按缺失处理 */
    targetBounds?: {
        x?: number | null;
        y?: number | null;
        left?: number | null;
        top?: number | null;
        right?: number | null;
        bottom?: number | null;
        width?: number | null;
        height?: number | null;
    };
    /** 目标区域适配方式 */
    targetFit?: 'contain' | 'cover' | 'fill';
    /** 图层层级：belowText 用于让置入图位于可编辑文字下方 */
    layerOrder?: 'front' | 'belowText' | 'back';
    /** 来源资产ID（Agent 侧传入，用于追踪） */
    sourceAssetId?: string;
    /** 来源校验和（Agent 侧传入，用于一致性校验） */
    sourceChecksum?: string;
    /** 来源字节长度（Agent 侧传入，用于一致性校验） */
    sourceByteLength?: number;
    /** 来源路径（仅日志） */
    sourcePath?: string;
}

function getLayerBoundsNoEffects(layer: any): any {
    return layer?.boundsNoEffects || layer?.bounds;
}

function toFiniteNumber(value: any): number | undefined {
    // null/undefined 绝不映射为 0：模型高频把没用的字段填 null（如 {x:100, left:null}），
    // Number(null)=0 会抢在 ?? 回退链之前生效，把图层错落到 (0,0)。
    if (value === null || value === undefined) return undefined;
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : undefined;
    }
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed === '') return undefined;
        const parsed = Number(trimmed);
        return Number.isFinite(parsed) ? parsed : undefined;
    }
    // 布尔/数组等其他类型不做隐式强转（Number(false)=0、Number([80])=80 都是意外语义）。
    return undefined;
}

function normalizeTargetBounds(value: PlaceImageParams['targetBounds']): { left: number; top: number; width: number; height: number } | null {
    if (!value || typeof value !== 'object') return null;
    const left = toFiniteNumber(value.left) ?? toFiniteNumber(value.x);
    const top = toFiniteNumber(value.top) ?? toFiniteNumber(value.y);
    const width = toFiniteNumber(value.width);
    const height = toFiniteNumber(value.height);
    const right = toFiniteNumber(value.right);
    const bottom = toFiniteNumber(value.bottom);
    const resolvedWidth = width ?? (right !== undefined && left !== undefined ? right - left : undefined);
    const resolvedHeight = height ?? (bottom !== undefined && top !== undefined ? bottom - top : undefined);
    if (left === undefined || top === undefined || resolvedWidth === undefined || resolvedHeight === undefined) return null;
    if (resolvedWidth <= 0 || resolvedHeight <= 0) return null;
    return { left, top, width: resolvedWidth, height: resolvedHeight };
}

function getLayerPixelSize(layer: any): { left: number; top: number; width: number; height: number } {
    const bounds = getLayerBoundsNoEffects(layer);
    const left = Number(bounds.left || 0);
    const top = Number(bounds.top || 0);
    const right = Number(bounds.right || left);
    const bottom = Number(bounds.bottom || top);
    return {
        left,
        top,
        width: Math.max(1, right - left),
        height: Math.max(1, bottom - top)
    };
}

async function translateLayerWithoutNativeMove(layer: any, offsetX: number, offsetY: number): Promise<void> {
    if (offsetX === 0 && offsetY === 0) {
        return;
    }
    if (typeof layer?.translate !== 'function') {
        throw new Error('置入图片定位失败：图层对象不支持 translate，已拒绝调用 Photoshop 原生 move 命令以避免弹窗。');
    }
    await Promise.resolve(layer.translate(offsetX, offsetY));
}

async function transformLayerPercent(widthPercent: number, heightPercent: number): Promise<void> {
    await action.batchPlay([
        {
            _obj: 'transform',
            freeTransformCenterState: {
                _enum: 'quadCenterState',
                _value: 'QCSAverage'
            },
            width: {
                _unit: 'percentUnit',
                _value: widthPercent
            },
            height: {
                _unit: 'percentUnit',
                _value: heightPercent
            },
            _options: {
                dialogOptions: 'dontDisplay'
            }
        }
    ], { synchronousExecution: true });
}

/**
 * 把图层缩放并移动到目标区域（必须在 executeAsModal 内调用，且目标图层已被选中）。
 * 注意：本函数与 src/tools/layer/transform-layer.ts 中的 fitLayerToTargetBounds
 * （含 normalizeTargetBounds / getLayerPixelSize / transformLayerPercent）保持一致实现，
 * UXP 端暂无共享几何 util 惯例；修改任意一处算法时必须同步另一处，并同步 Agent 侧验收断言
 * （DesignEcho-Agent/src/shared/acceptance/tool-acceptance.ts 的 targetBounds 尺寸断言）。
 */
async function fitLayerToTargetBounds(
    layer: any,
    target: { left: number; top: number; width: number; height: number },
    fit: PlaceImageParams['targetFit'] = 'contain'
): Promise<void> {
    const before = getLayerPixelSize(layer);
    const scaleX = (target.width / before.width) * 100;
    const scaleY = (target.height / before.height) * 100;
    const normalizedFit = fit === 'cover' || fit === 'fill' ? fit : 'contain';
    const widthPercent = normalizedFit === 'fill'
        ? scaleX
        : normalizedFit === 'cover'
            ? Math.max(scaleX, scaleY)
            : Math.min(scaleX, scaleY);
    const heightPercent = normalizedFit === 'fill' ? scaleY : widthPercent;

    if (Math.abs(widthPercent - 100) > 0.05 || Math.abs(heightPercent - 100) > 0.05) {
        await transformLayerPercent(widthPercent, heightPercent);
    }

    const after = getLayerPixelSize(layer);
    const targetX = normalizedFit === 'fill' ? target.left : target.left + (target.width - after.width) / 2;
    const targetY = normalizedFit === 'fill' ? target.top : target.top + (target.height - after.height) / 2;
    await translateLayerWithoutNativeMove(layer, targetX - after.left, targetY - after.top);
}

function findLayerLocation(container: any, id: number): { layer: any; parent: any; index: number } | null {
    const layers = container?.layers || [];
    for (let i = 0; i < layers.length; i++) {
        const layer = layers[i];
        if (layer?.id === id) {
            return { layer, parent: container, index: i };
        }
        if (layer?.layers) {
            const nested = findLayerLocation(layer, id);
            if (nested) return nested;
        }
    }
    return null;
}

function isTextLayer(layer: any): boolean {
    const kind = String(layer?.kind || layer?.typename || layer?._class || '').toLowerCase();
    return kind.includes('text') || Boolean(layer?.textItem) || Boolean(layer?.text);
}

function getElementPlacement(name: 'PLACEAFTER'): unknown {
    return getPhotoshopElementPlacement(constants, name, 'PlaceImageTool');
}

async function selectLayerById(layerId: number): Promise<void> {
    await action.batchPlay([
        {
            _obj: 'select',
            _target: [{ _ref: 'layer', _id: layerId }],
            makeVisible: false,
            _options: { dialogOptions: 'dontDisplay' }
        }
    ], { synchronousExecution: true });
}

function moveLayerAfter(layer: any, relativeLayer: any): void {
    if (typeof layer?.move !== 'function') {
        throw new Error('置入图片层级调整失败：当前 Photoshop UXP 环境不支持 layer.move');
    }
    layer.move(relativeLayer, getElementPlacement('PLACEAFTER'));
}

async function movePlacedLayerBelowText(doc: any, layer: any): Promise<void> {
    const location = findLayerLocation(doc, layer.id);
    if (!location) {
        throw new Error('置入图片层级调整失败：无法读取新图层位置');
    }
    const siblings = (location.parent?.layers || []).filter((item: any) => !item?.isBackgroundLayer && item?.id !== layer.id);
    const textSiblings = siblings.filter(isTextLayer);
    if (textSiblings.length === 0) {
        return;
    }
    const lowestTextSibling = textSiblings[textSiblings.length - 1];
    moveLayerAfter(layer, lowestTextSibling);
    await selectLayerById(layer.id);
}

async function applyPlacedLayerOrder(doc: any, layer: any, layerOrder: PlaceImageParams['layerOrder']): Promise<void> {
    if (layerOrder === 'belowText') {
        await movePlacedLayerBelowText(doc, layer);
        return;
    }
    if (layerOrder === 'back') {
        if (typeof layer?.sendToBack !== 'function') {
            throw new Error('置入图片层级调整失败：当前 Photoshop UXP 环境不支持 layer.sendToBack');
        }
        layer.sendToBack();
        await selectLayerById(layer.id);
    }
}

function calcChecksum(bytes: Uint8Array): string {
    // FNV-1a 32-bit, same as Agent side.
    let hash = 0x811c9dc5;
    for (let i = 0; i < bytes.length; i++) {
        hash ^= bytes[i];
        hash = Math.imul(hash, 0x01000193);
    }
    const hex = (hash >>> 0).toString(16).padStart(8, '0');
    return `fnv1a32:${hex}`;
}

function extensionFromPath(filePath: string): string {
    const match = String(filePath || '').match(/\.([a-z0-9]+)$/i);
    return match ? match[1].toLowerCase() : '';
}

export class PlaceImageTool implements Tool {
    name = 'placeImage';
    
    get schema(): ToolSchema {
        return {
            name: this.name,
            description: '将图片置入到当前文档中，支持从项目目录选择图片置入',
            parameters: {
                type: 'object',
                properties: {
                    imageData: {
                        type: 'string',
                        description: '图片的 Base64 数据（与 filePath 二选一，用于适配 UXP 文件访问限制）'
                    },
                    imageFormat: {
                        type: 'string',
                        description: 'imageData 时的格式：png|jpeg|gif（默认 png）'
                    },
                    filePath: {
                        type: 'string',
                        description: '图片文件的本地路径（与 imageData 二选一）'
                    },
                    fileToken: {
                        type: 'string',
                        description: 'UXP 会话文件 token（优先于 filePath）'
                    },
                    name: {
                        type: 'string',
                        description: '置入后的图层名称'
                    },
                    x: {
                        type: 'number',
                        description: '置入位置 X 坐标（像素）'
                    },
                    y: {
                        type: 'number',
                        description: '置入位置 Y 坐标（像素）'
                    },
                    scale: {
                        type: 'number',
                        description: '缩放百分比，默认 100；可大于 100 表示放大（如 150 表示放大到 150%）'
                    },
                    center: {
                        type: 'boolean',
                        description: '是否居中置入，默认 true'
                    },
                    fitToCanvas: {
                        type: 'boolean',
                        description: '是否自动缩放以适应画布。默认只缩小不放大（封顶 100%）；小图铺满画布需同时传 allowUpscale:true'
                    },
                    allowUpscale: {
                        type: 'boolean',
                        description: '配合 fitToCanvas：true 时允许放大超过原始尺寸铺满画布，默认 false 保持只缩不放'
                    },
                    targetBounds: {
                        type: 'object',
                        description: '目标区域，支持 {x,y,width,height} 或 {left,top,right,bottom}；多图详情页排版时用于避免默认居中重叠'
                    },
                    targetFit: {
                        type: 'string',
                        description: '目标区域适配方式：contain、cover 或 fill，默认 contain'
                    },
                    layerOrder: {
                        type: 'string',
                        enum: ['front', 'belowText', 'back'],
                        description: '置入后的图层层级。和 renderLayout 可编辑文字同用时使用 belowText，避免图片遮挡标题和卖点。'
                    }
                }
            }
        };
    }

    async execute(params: PlaceImageParams, context?: ToolExecutionContext): Promise<ToolResult> {
        if (isRequestCancelled(context)) {
            return buildCancelledToolResult();
        }
        const doc = app.activeDocument;
        if (!doc) {
            return createToolFailureResult({ toolName: this.name, error: '没有打开的文档', params });
        }

        const {
            imageData: rawImageData,
            filePath,
            name = '置入的图片',
            x,
            y,
            scale = 100,
            center = true,
            fitToCanvas = false,
            allowUpscale = false,
            sourceAssetId,
            sourceChecksum,
            sourceByteLength,
            sourcePath,
            targetBounds,
            targetFit = 'contain',
            layerOrder = 'front'
        } = params;
        const imageData = rawImageData || (params as any).base64;
        const normalizedTargetBounds = normalizeTargetBounds(targetBounds);

        if (!imageData && !filePath && !params.fileToken) {
            return createToolFailureResult({ toolName: this.name, error: '必须提供 imageData 或 filePath 或 fileToken', params });
        }

        try {
            let placedLayerId: number | null = null;
            let tokenPath: string | undefined;

            throwIfRequestCancelled(context);
            await core.executeAsModal(async () => {
                throwIfRequestCancelled(context);
                // 使用 batchPlay 置入图片
                if (params.fileToken || filePath) {
                    tokenPath = params.fileToken;
                    if (!tokenPath && filePath) {
                        const fileEntry = await getEntryFromPath(fs, filePath);
                        if (!fileEntry) {
                            throw new Error(`无法访问文件: ${filePath}`);
                        }
                        const bytes = await readFileEntryBytes(fileEntry, uxp.storage);
                        throwIfRequestCancelled(context);
                        assertImageBytesSafeForPhotoshop(bytes, {
                            formatHint: extensionFromPath(filePath),
                            sourceLabel: `图片文件「${filePath.split(/[\\/]/).pop() || filePath}」`
                        });
                        tokenPath = await fs.createSessionToken(fileEntry);
                    }

                    // 从文件路径置入
                    throwIfRequestCancelled(context);
                    const result = await action.batchPlay([
                        {
                            _obj: 'placeEvent',
                            null: {
                                _kind: 'local',
                                _path: tokenPath
                            },
                            freeTransformCenterState: {
                                _enum: 'quadCenterState',
                                _value: 'QCSAverage'
                            },
                            offset: {
                                _obj: 'offset',
                                horizontal: {
                                    _unit: 'pixelsUnit',
                                    _value: 0
                                },
                                vertical: {
                                    _unit: 'pixelsUnit',
                                    _value: 0
                                }
                            },
                            _options: {
                                dialogOptions: 'dontDisplay'
                            }
                        }
                    ], { synchronousExecution: true });

                    if (result && result[0]) {
                        placedLayerId = doc.activeLayers[0]?.id;
                    }
                } else if (imageData) {
                    // 从 Base64 数据置入：写入 UXP 可访问的临时文件 → placeEvent
                    throwIfRequestCancelled(context);
                    const storage = uxp.storage;
                    const tempFolder = await fs.getTemporaryFolder();
                    const ext = (params.imageFormat || 'png').replace(/^\./, '') || 'png';
                    const tempFileName = `place_${Date.now()}.${ext}`;
                    const tempFile = await tempFolder.createFile(tempFileName, { overwrite: true });
                    const decoded = bytesFromBase64ImagePayload(imageData);
                    const bytes = decoded.bytes;
                    assertImageBytesSafeForPhotoshop(bytes, {
                        formatHint: ext || decoded.mimeType,
                        sourceLabel: name ? `图片「${name}」` : 'Base64 图片'
                    });
                    if (typeof sourceByteLength === 'number' && sourceByteLength > 0 && sourceByteLength !== bytes.length) {
                        throw new Error(`源图字节长度不一致: expected=${sourceByteLength}, actual=${bytes.length}`);
                    }
                    if (sourceChecksum) {
                        const actualChecksum = calcChecksum(bytes);
                        if (actualChecksum !== sourceChecksum) {
                            throw new Error(`源图校验失败: expected=${sourceChecksum}, actual=${actualChecksum}`);
                        }
                    }
                    if (sourceAssetId) {
                        console.log(`[placeImage] 置入来源 assetId=${sourceAssetId}, sourcePath=${sourcePath || filePath || 'n/a'}`);
                    }
                    await tempFile.write(arrayBufferFromBytes(bytes), { format: storage.formats.binary });
                    const sessionToken = await fs.createSessionToken(tempFile);
                    throwIfRequestCancelled(context);
                    const placeResult = await action.batchPlay([
                        {
                            _obj: 'placeEvent',
                            null: { _path: sessionToken, _kind: 'local' },
                            freeTransformCenterState: { _enum: 'quadCenterState', _value: 'QCSAverage' },
                            offset: { _obj: 'offset', horizontal: { _unit: 'pixelsUnit', _value: 0 }, vertical: { _unit: 'pixelsUnit', _value: 0 } },
                            _options: { dialogOptions: 'dontDisplay' }
                        }
                    ], { synchronousExecution: true });
                    if (placeResult?.[0]) placedLayerId = doc.activeLayers[0]?.id;
                    try { await tempFile.delete(); } catch { /* ignore */ }
                }
                throwIfRequestCancelled(context);

                // 获取置入后的图层
                const newLayer = doc.activeLayers[0];
                if (!newLayer) {
                    throw new Error('置入失败，未找到新图层');
                }

                placedLayerId = newLayer.id;

                // 重命名图层
                if (name) {
                    newLayer.name = name;
                }

                // 处理目标区域；它优先于普通居中/缩放，用于详情页多图排版。
                if (normalizedTargetBounds) {
                    throwIfRequestCancelled(context);
                    await fitLayerToTargetBounds(newLayer, normalizedTargetBounds, targetFit);
                } else if (fitToCanvas || scale !== 100) {
                    const layerBounds = getLayerBoundsNoEffects(newLayer);
                    const layerWidth = layerBounds.right - layerBounds.left;
                    const layerHeight = layerBounds.bottom - layerBounds.top;
                    
                    let targetScale = scale;
                    
                    if (fitToCanvas) {
                        // 计算适应画布的缩放比例；默认只缩不放（封顶 100%），
                        // allowUpscale=true 时解除封顶，允许小图放大铺满画布。
                        const docWidth = doc.width;
                        const docHeight = doc.height;
                        const scaleX = (docWidth / layerWidth) * 100;
                        const scaleY = (docHeight / layerHeight) * 100;
                        const fitScale = Math.min(scaleX, scaleY);
                        targetScale = allowUpscale ? fitScale : Math.min(fitScale, 100);
                    }

                    if (targetScale !== 100) {
                        throwIfRequestCancelled(context);
                        await transformLayerPercent(targetScale, targetScale);
                    }
                }

                // 处理位置
                if (normalizedTargetBounds) {
                    // 目标区域已经完成定位。
                } else if (x !== undefined || y !== undefined) {
                    // 移动到指定位置
                    const layerBounds = getLayerBoundsNoEffects(newLayer);
                    const currentX = layerBounds.left;
                    const currentY = layerBounds.top;

                    const moveX = (x ?? currentX) - currentX;
                    const moveY = (y ?? currentY) - currentY;

                    throwIfRequestCancelled(context);
                    await translateLayerWithoutNativeMove(newLayer, moveX, moveY);
                } else if (center) {
                    // 居中置入
                    const layerBounds = getLayerBoundsNoEffects(newLayer);
                    const layerWidth = layerBounds.right - layerBounds.left;
                    const layerHeight = layerBounds.bottom - layerBounds.top;
                    const docWidth = doc.width;
                    const docHeight = doc.height;

                    const targetX = (docWidth - layerWidth) / 2;
                    const targetY = (docHeight - layerHeight) / 2;
                    const currentX = layerBounds.left;
                    const currentY = layerBounds.top;

                    const moveX = targetX - currentX;
                    const moveY = targetY - currentY;

                    throwIfRequestCancelled(context);
                    await translateLayerWithoutNativeMove(newLayer, moveX, moveY);
                }

                throwIfRequestCancelled(context);
                await applyPlacedLayerOrder(doc, newLayer, layerOrder);
            }, { commandName: 'DesignEcho: 置入图片' });

            if (isRequestCancelled(context)) {
                return buildCancelledToolResult();
            }
            // 获取最终图层信息：递归查找（layerOrder/belowText 等会把新图层挪进组内，
            // 顶层 doc.layers.find 会漏掉组内图层导致 bounds:null，模型拿不到落位结果）
            const finalLayerLocation = typeof placedLayerId === 'number'
                ? findLayerLocation(doc, placedLayerId)
                : null;
            const finalLayer = finalLayerLocation?.layer;
            const finalBounds = finalLayer ? getLayerBoundsNoEffects(finalLayer) : undefined;

            return {
                success: true,
                data: {
                    layerId: placedLayerId,
                    layerName: name,
                    bounds: finalBounds ? {
                        left: finalBounds.left,
                        top: finalBounds.top,
                        right: finalBounds.right,
                        bottom: finalBounds.bottom,
                        width: finalBounds.right - finalBounds.left,
                        height: finalBounds.bottom - finalBounds.top
                    } : null,
                    source: {
                        assetId: sourceAssetId,
                        checksum: sourceChecksum,
                        byteLength: sourceByteLength
                    },
                    message: `成功置入图片「${name}」`
                }
            };

        } catch (error: any) {
            if (error?.code === REQUEST_CANCELLED_ERROR || isRequestCancelled(context)) {
                return buildCancelledToolResult();
            }
            const failure = createToolFailureResult({ toolName: this.name, error, params });
            return {
                ...failure,
                data: {
                    popupPrevented: true,
                    reason: failure.errorDetails.category === 'image_decode_error'
                        ? 'image-preflight-failed'
                        : 'photoshop-command-failed',
                    source: {
                        hasFilePath: !!filePath,
                        hasImageData: !!imageData,
                        assetId: sourceAssetId
                    }
                },
            };
        }
    }
}

export default PlaceImageTool;
