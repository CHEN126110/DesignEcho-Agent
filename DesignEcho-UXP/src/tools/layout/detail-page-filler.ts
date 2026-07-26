/**
 * Detail page bulk filler.
 * Fills copy and images into a parsed detail-page template.
 */

import { app, action, core } from 'photoshop';
import { SetTextContentTool } from '../text/set-text-content';
import { getBounds } from './layer-utils';
import { assertImageBytesSafeForPhotoshop, readFileEntryBytes } from '../../core/image-safety';
import { getPhotoshopElementPlacement } from './photoshop-runtime-adapters';

const uxp = require('uxp');
const fs = uxp.storage.localFileSystem;
const { constants } = require('photoshop');

type FillMode = 'cover' | 'contain' | 'smart' | 'aesthetic';
type AssetType = 'product' | 'model' | 'detail' | 'scene' | 'icon';
type ContentSource = 'knowledge' | 'ai_generated' | 'user_input' | 'template';
type ScreenType = string;

interface FillPlan {
    screenId: number;
    screenName: string;
    screenType: ScreenType;
    copies: CopyFillItem[];
    images: ImageFillItem[];
    icons?: IconFillItem[];
    confidence: number;
    needsReview: boolean;
}

interface CopyFillItem {
    layerId: number;
    layerName: string;
    content: string;
    source: ContentSource;
    sourceId?: string;
    originalText?: string;
}

interface ImageFillItem {
    layerId: number;
    layerName: string;
    imagePath: string;
    fillMode: FillMode;
    assetType: AssetType;
    needsMatting?: boolean;
    subjectAlign?: 'center' | 'left' | 'right' | 'top' | 'bottom';
    isClippingMask?: boolean;
    baseLayerId?: number;
    referenceLayerId?: number;
    targetBounds?: Rect & { width?: number; height?: number };
    zone?: 'copy' | 'icon' | 'image' | 'unknown';
    placementTransform?: {
        destinationBox?: PlacementBox;
        visibleBox?: PlacementBox;
        scale?: number;
        scaleX?: number;
        scaleY?: number;
        anchor?: string;
        scaleMode?: string;
        cropRisk?: boolean;
        notes?: string[];
    };
    smartScalingDecision?: {
        destinationBox?: PlacementBox;
        cropRisk?: string;
        confidence?: number;
        warnings?: string[];
    };
}

interface IconFillItem {
    layerId: number;
    layerName: string;
    iconPath?: string;
    iconContent?: string;
}

interface FillResult {
    success: boolean;
    screenId: number;
    screenName: string;
    copiesFilled: number;
    imagesFilled: number;
    placements: ImagePlacementRecord[];
    placementAuditSummary: PlacementAuditSummary;
    errors: string[];
}

interface ImagePlacementRecord {
    screenId: number;
    screenName: string;
    placeholderLayerId: number;
    placeholderLayerName: string;
    actualLayerId: number;
    actualLayerName: string;
    targetBounds: Rect & { width: number; height: number };
    actualBounds: Rect & { width: number; height: number };
    baseLayerId?: number;
    referenceLayerId?: number;
    parentGroupName?: string;
    isClipped: boolean;
    fillMode: FillMode;
    subjectAlign?: 'center' | 'left' | 'right' | 'top' | 'bottom';
    placementAudit?: PlacementAudit;
}

interface PlacementAudit {
    strategy: 'placementTransform' | 'smartScalingDecision' | 'fitFallback';
    plannedBounds?: Rect & { width: number; height: number };
    deviation?: {
        left: number;
        top: number;
        width: number;
        height: number;
        maxAbs: number;
    };
    status: 'ok' | 'watch' | 'mismatch' | 'unverified';
    smartScaling?: {
        plannedBounds?: Rect & { width: number; height: number };
        confidence?: number;
        cropRisk?: string;
        warnings?: string[];
    };
    notes: string[];
}

interface PlacementAuditSummary {
    total: number;
    ok: number;
    watch: number;
    mismatch: number;
    unverified: number;
    usedPlacementTransform: number;
    usedSmartScalingDecision: number;
    usedFallback: number;
}

// Rect type kept for local usage (subset of BoundingBox)
interface Rect {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

interface PlacementBox {
    x: number;
    y: number;
    width: number;
    height: number;
}

function layerRect(layer: any): Rect {
    const b = getBounds(layer);
    return { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
}

function normalizeRect(rect: any): Rect | null {
    if (!rect) return null;
    const left = Number(rect.left);
    const top = Number(rect.top);
    const right = Number(rect.right);
    const bottom = Number(rect.bottom);
    if (![left, top, right, bottom].every((value) => Number.isFinite(value))) {
        return null;
    }
    if (right <= left || bottom <= top) {
        return null;
    }
    return { left, top, right, bottom };
}

function normalizePlacementBox(box: any): PlacementBox | null {
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

function placementBoxToRect(box: PlacementBox): Rect {
    return {
        left: box.x,
        top: box.y,
        right: box.x + box.width,
        bottom: box.y + box.height
    };
}

function rectContains(outer: Rect, inner: Rect): boolean {
    return inner.left >= outer.left
        && inner.top >= outer.top
        && inner.right <= outer.right
        && inner.bottom <= outer.bottom;
}

function rectWithSize(rect: Rect): Rect & { width: number; height: number } {
    return {
        ...rect,
        width: Math.max(1, rect.right - rect.left),
        height: Math.max(1, rect.bottom - rect.top)
    };
}

function basename(filePath: string): string {
    return String(filePath || '').split(/[\\/]/).pop() || String(filePath || '');
}

function extensionFromPath(filePath: string): string {
    const match = String(filePath || '').match(/\.([a-z0-9]+)$/i);
    return match ? match[1].toLowerCase() : '';
}

function buildRectDeviation(planned: Rect, actual: Rect): PlacementAudit['deviation'] {
    const plannedSized = rectWithSize(planned);
    const actualSized = rectWithSize(actual);
    const deviation = {
        left: actual.left - planned.left,
        top: actual.top - planned.top,
        width: actualSized.width - plannedSized.width,
        height: actualSized.height - plannedSized.height,
        maxAbs: 0
    };
    deviation.maxAbs = Math.max(
        Math.abs(deviation.left),
        Math.abs(deviation.top),
        Math.abs(deviation.width),
        Math.abs(deviation.height)
    );
    return deviation;
}

function statusFromRectDeviation(maxAbs: number): PlacementAudit['status'] {
    if (maxAbs <= 2) return 'ok';
    if (maxAbs <= 8) return 'watch';
    return 'mismatch';
}

function buildPlacementAudit(input: {
    strategy: PlacementAudit['strategy'];
    plannedRect?: Rect | null;
    actualRect: Rect;
    smartScalingDecision?: ImageFillItem['smartScalingDecision'];
}): PlacementAudit {
    const notes: string[] = [];
    const plannedBounds = input.plannedRect ? rectWithSize(input.plannedRect) : undefined;
    const deviation = input.plannedRect ? buildRectDeviation(input.plannedRect, input.actualRect) : undefined;
    let status: PlacementAudit['status'] = 'unverified';

    if (deviation) {
        status = statusFromRectDeviation(deviation.maxAbs);
        if (status !== 'ok') {
            notes.push(`actual bounds deviate from planned bounds by ${deviation.maxAbs.toFixed(1)}px`);
        }
    } else {
        notes.push('no planned destination bounds available for post-transform verification');
    }

    const smartDestination = normalizePlacementBox(input.smartScalingDecision?.destinationBox);
    const smartPlannedBounds = smartDestination ? rectWithSize(placementBoxToRect(smartDestination)) : undefined;
    if (input.smartScalingDecision?.warnings?.length) {
        notes.push(...input.smartScalingDecision.warnings);
    }

    return {
        strategy: input.strategy,
        plannedBounds,
        deviation,
        status,
        smartScaling: input.smartScalingDecision
            ? {
                plannedBounds: smartPlannedBounds,
                confidence: Number(input.smartScalingDecision.confidence || 0) || undefined,
                cropRisk: input.smartScalingDecision.cropRisk,
                warnings: input.smartScalingDecision.warnings || []
            }
            : undefined,
        notes
    };
}

function summarizePlacementAudits(placements: ImagePlacementRecord[]): PlacementAuditSummary {
    const summary: PlacementAuditSummary = {
        total: placements.length,
        ok: 0,
        watch: 0,
        mismatch: 0,
        unverified: 0,
        usedPlacementTransform: 0,
        usedSmartScalingDecision: 0,
        usedFallback: 0
    };

    for (const placement of placements) {
        const audit = placement.placementAudit;
        if (!audit) {
            summary.unverified++;
            continue;
        }
        summary[audit.status]++;
        if (audit.strategy === 'placementTransform') summary.usedPlacementTransform++;
        else if (audit.strategy === 'smartScalingDecision') summary.usedSmartScalingDecision++;
        else summary.usedFallback++;
    }

    return summary;
}

export class DetailPageFiller {
    async fill(plan: FillPlan): Promise<FillResult> {
        const errors: string[] = [];
        const placements: ImagePlacementRecord[] = [];
        let copiesFilled = 0;
        let imagesFilled = 0;

        console.log(`[DetailPageFiller] Start screen: ${plan.screenName}`);

        for (const copy of plan.copies || []) {
            try {
                await this.fillCopy(copy);
                copiesFilled++;
                console.log(`[DetailPageFiller] Copy filled: ${copy.layerName}`);
            } catch (e: any) {
                const message = e?.message || String(e);
                errors.push(`copy failed [${copy.layerName}]: ${message}`);
                console.error(`[DetailPageFiller] Copy failed: ${copy.layerName}`, e);
            }
        }

        for (const image of plan.images || []) {
            if (!image.imagePath) {
                continue;
            }
            try {
                const placement = await this.fillImage(image, plan.screenId, plan.screenName);
                if (placement) {
                    placements.push(placement);
                }
                imagesFilled++;
                console.log(`[DetailPageFiller] Image filled: ${image.layerName}`);
            } catch (e: any) {
                const message = e?.message || String(e);
                errors.push(`image failed [${image.layerName}]: ${message}`);
                console.error(`[DetailPageFiller] Image failed: ${image.layerName}`, e);
            }
        }

        for (const icon of plan.icons || []) {
            try {
                await this.fillIcon(icon);
            } catch (e: any) {
                const message = e?.message || String(e);
                errors.push(`icon failed [${icon.layerName}]: ${message}`);
            }
        }

        return {
            success: errors.length === 0,
            screenId: plan.screenId,
            screenName: plan.screenName,
            copiesFilled,
            imagesFilled,
            placements,
            placementAuditSummary: summarizePlacementAudits(placements),
            errors
        };
    }

    async fillAll(plans: FillPlan[]): Promise<FillResult[]> {
        const results: FillResult[] = [];
        for (const plan of plans || []) {
            results.push(await this.fill(plan));
        }
        return results;
    }

    private async fillCopy(item: CopyFillItem): Promise<void> {
        // Use setTextContent tool to preserve text style and avoid style reset.
        const setTextTool = new SetTextContentTool();
        const result = await setTextTool.execute({
            layerId: item.layerId,
            content: String(item.content || '')
        });
        if (!result?.success) {
            throw new Error(result?.error || `copy fill failed: ${item.layerName}`);
        }
    }

    private async fillImage(
        item: ImageFillItem,
        screenId: number,
        screenName: string
    ): Promise<ImagePlacementRecord> {
        let placementRecord: ImagePlacementRecord | null = null;

        await core.executeAsModal(async () => {
            const doc = app.activeDocument;
            if (!doc) throw new Error('No active document');

            const placeholderLayer = this.findLayerById(doc.layers, item.layerId);
            if (!placeholderLayer) {
                throw new Error(`Target layer not found: ${item.layerId}`);
            }

            const clippingBaseLayer = item.baseLayerId
                ? this.findLayerById(doc.layers, item.baseLayerId)
                : null;
            const referenceLayer = item.referenceLayerId
                ? this.findLayerById(doc.layers, item.referenceLayerId)
                : null;
            const targetLayer = clippingBaseLayer || placeholderLayer;
            const stackAnchorLayer = clippingBaseLayer || referenceLayer || placeholderLayer;
            const targetRect = normalizeRect(item.targetBounds) || layerRect(targetLayer);
            const targetWidth = Math.max(1, targetRect.right - targetRect.left);
            const targetHeight = Math.max(1, targetRect.bottom - targetRect.top);
            const targetCenterX = targetRect.left + (targetWidth / 2);
            const targetCenterY = targetRect.top + (targetHeight / 2);

            const fileEntry = await fs.getEntryWithUrl('file:' + item.imagePath);
            if (!fileEntry) {
                throw new Error(`Cannot access file: ${item.imagePath}`);
            }
            const imageBytes = await readFileEntryBytes(fileEntry, uxp.storage);
            assertImageBytesSafeForPhotoshop(imageBytes, {
                formatHint: extensionFromPath(item.imagePath),
                sourceLabel: `详情页图片「${basename(item.imagePath)}」`
            });
            const token = await fs.createSessionToken(fileEntry);

            await action.batchPlay([{
                _obj: 'placeEvent',
                null: { _path: token, _kind: 'local' },
                freeTransformCenterState: { _enum: 'quadCenterState', _value: 'QCSAverage' },
                offset: {
                    _obj: 'offset',
                    horizontal: { _unit: 'pixelsUnit', _value: targetCenterX },
                    vertical: { _unit: 'pixelsUnit', _value: targetCenterY }
                },
                _options: { dialogOptions: 'dontDisplay' }
            }], { synchronousExecution: true });

            const placedLayer = doc.activeLayers?.[0];
            if (!placedLayer) {
                throw new Error('Placed layer missing');
            }

            try {
                placedLayer.name = item.layerName || placedLayer.name;
            } catch {
                // Ignore rename failures.
            }

            await this.moveLayerAbove(placedLayer, stackAnchorLayer);
            const shouldClip = !!clippingBaseLayer
                || !!item.isClippingMask
                || !!placeholderLayer.clipped;
            const transformDestination = normalizePlacementBox(item.placementTransform?.destinationBox);
            const transformVisible = normalizePlacementBox(item.placementTransform?.visibleBox);
            const smartScalingDestination = normalizePlacementBox(item.smartScalingDecision?.destinationBox);
            const transformDestinationRect = transformDestination ? placementBoxToRect(transformDestination) : null;
            const transformVisibleRect = transformVisible ? placementBoxToRect(transformVisible) : null;
            const smartScalingDestinationRect = smartScalingDestination ? placementBoxToRect(smartScalingDestination) : null;
            const canUseTransformDestination = !!transformDestinationRect
                && (shouldClip || rectContains(targetRect, transformDestinationRect));
            const canUseSmartScalingDestination = !canUseTransformDestination
                && !!smartScalingDestinationRect
                && (shouldClip || rectContains(targetRect, smartScalingDestinationRect));
            const destinationRect = canUseTransformDestination
                ? transformDestinationRect
                : canUseSmartScalingDestination
                    ? smartScalingDestinationRect
                    : null;
            const placementStrategy: PlacementAudit['strategy'] = canUseTransformDestination
                ? 'placementTransform'
                : canUseSmartScalingDestination
                    ? 'smartScalingDecision'
                    : 'fitFallback';

            if (destinationRect) {
                await this.scaleToRect(placedLayer, destinationRect);
            } else {
                await this.scaleToFit(placedLayer, targetWidth, targetHeight, item.fillMode || 'cover');
                const alignRect = transformVisibleRect || targetRect;
                await this.positionPlacedLayer(placedLayer, alignRect, item.subjectAlign || 'center');
            }

            if (shouldClip) {
                await this.createClippingMask(placedLayer);
            }

            if (!clippingBaseLayer || placeholderLayer.id !== clippingBaseLayer.id) {
                try {
                    await placeholderLayer.delete();
                } catch {
                    placeholderLayer.visible = false;
                }
            }

            let placedRect = layerRect(placedLayer);
            const auditPlannedRect = destinationRect
                ? destinationRect
                : transformVisibleRect || targetRect;

            // 放置后回正护栏：替换/缩放在个别智能对象上会让图层落到远离目标的位置
            // （实测：素材被丢到画布外 9000+px，撑爆所在屏分组的边界）。
            // 中心偏差超阈值时按计划位置平移回正，再重新读取实际边界供审计使用。
            if (auditPlannedRect) {
                const plannedCenterX = (auditPlannedRect.left + auditPlannedRect.right) / 2;
                const plannedCenterY = (auditPlannedRect.top + auditPlannedRect.bottom) / 2;
                const actualCenterX = (placedRect.left + placedRect.right) / 2;
                const actualCenterY = (placedRect.top + placedRect.bottom) / 2;
                const centerDrift = Math.max(
                    Math.abs(actualCenterX - plannedCenterX),
                    Math.abs(actualCenterY - plannedCenterY)
                );
                if (centerDrift > 24) {
                    await this.translateLayer(
                        placedLayer,
                        plannedCenterX - actualCenterX,
                        plannedCenterY - actualCenterY
                    );
                    placedRect = layerRect(placedLayer);
                }
            }
            placementRecord = {
                screenId,
                screenName,
                placeholderLayerId: item.layerId,
                placeholderLayerName: item.layerName,
                actualLayerId: Number(placedLayer.id || 0),
                actualLayerName: String(placedLayer.name || item.layerName || 'Placed Image'),
                targetBounds: {
                    ...targetRect,
                    width: targetWidth,
                    height: targetHeight
                },
                actualBounds: {
                    ...placedRect,
                    width: Math.max(1, placedRect.right - placedRect.left),
                    height: Math.max(1, placedRect.bottom - placedRect.top)
                },
                baseLayerId: item.baseLayerId,
                referenceLayerId: item.referenceLayerId,
                parentGroupName: String((placedLayer as any)?.parent?.name || ''),
                isClipped: shouldClip,
                fillMode: item.fillMode || 'cover',
                subjectAlign: item.subjectAlign || 'center',
                placementAudit: buildPlacementAudit({
                    strategy: placementStrategy,
                    plannedRect: auditPlannedRect,
                    actualRect: placedRect,
                    smartScalingDecision: item.smartScalingDecision
                })
            };

        }, { commandName: `Fill image: ${item.layerName}` });

        if (!placementRecord) {
            throw new Error(`Image placement record missing: ${item.layerName}`);
        }
        return placementRecord;
    }

    private async fillIcon(item: IconFillItem): Promise<void> {
        if (!item.iconPath && !item.iconContent) {
            throw new Error(`Icon layer [${item.layerName}]: no iconPath or iconContent provided`);
        }

        await core.executeAsModal(async () => {
            const doc = app.activeDocument;
            if (!doc) throw new Error('No active document');

            const targetLayer = this.findLayerById(doc.layers, item.layerId);
            if (!targetLayer) {
                throw new Error(`Icon layer not found: ${item.layerId}`);
            }

            if (!item.iconPath) {
                return;
            }

            const fileEntry = await fs.getEntryWithUrl('file:' + item.iconPath);
            if (!fileEntry) {
                throw new Error(`Cannot access icon file: ${item.iconPath}`);
            }
            const iconBytes = await readFileEntryBytes(fileEntry, uxp.storage);
            assertImageBytesSafeForPhotoshop(iconBytes, {
                formatHint: extensionFromPath(item.iconPath),
                sourceLabel: `详情页图标「${basename(item.iconPath)}」`
            });

            const token = await fs.createSessionToken(fileEntry);
            const rect = layerRect(targetLayer);

            await action.batchPlay([{
                _obj: 'placeEvent',
                null: { _path: token, _kind: 'local' },
                offset: {
                    _obj: 'offset',
                    horizontal: { _unit: 'pixelsUnit', _value: (rect.left + rect.right) / 2 },
                    vertical: { _unit: 'pixelsUnit', _value: (rect.top + rect.bottom) / 2 }
                },
                _options: { dialogOptions: 'dontDisplay' }
            }], { synchronousExecution: true });

            const placedLayer = doc.activeLayers?.[0];
            if (!placedLayer) {
                throw new Error(`Icon place failed: no placed layer after placeEvent`);
            }

            const targetSize = Math.max(1, Math.min(rect.right - rect.left, rect.bottom - rect.top));
            await this.scaleToSize(placedLayer, targetSize, targetSize);

            try {
                await targetLayer.delete();
            } catch {
                targetLayer.visible = false;
            }
        }, { commandName: `Fill icon: ${item.layerName}` });
    }

    private async scaleToFit(
        layer: any,
        targetWidth: number,
        targetHeight: number,
        mode: FillMode
    ): Promise<void> {
        const rect = layerRect(layer);
        const currentWidth = Math.max(1, rect.right - rect.left);
        const currentHeight = Math.max(1, rect.bottom - rect.top);

        let scale: number;
        const containScale = Math.min(targetWidth / currentWidth, targetHeight / currentHeight);
        const coverScale = Math.max(targetWidth / currentWidth, targetHeight / currentHeight);
        if (mode === 'contain') {
            scale = containScale;
        } else if (mode === 'aesthetic') {
            scale = containScale * 0.7;
        } else if (mode === 'smart') {
            const ratioGap = Math.abs((targetWidth / Math.max(1, targetHeight)) - (currentWidth / Math.max(1, currentHeight)));
            const blend = ratioGap > 0.9 ? 0.72 : 0.5;
            scale = containScale + ((coverScale - containScale) * blend);
        } else {
            scale = coverScale;
        }

        const scalePercent = Math.max(1, scale * 100);
        await action.batchPlay([{
            _obj: 'transform',
            _target: [{ _ref: 'layer', _id: layer.id }],
            freeTransformCenterState: { _enum: 'quadCenterState', _value: 'QCSAverage' },
            width: { _unit: 'percentUnit', _value: scalePercent },
            height: { _unit: 'percentUnit', _value: scalePercent },
            interfaceIconFrameDimmed: { _enum: 'interpolationType', _value: 'bicubic' },
            _options: { dialogOptions: 'dontDisplay' }
        }], { synchronousExecution: true });
    }

    private async scaleToSize(layer: any, targetWidth: number, targetHeight: number): Promise<void> {
        const rect = layerRect(layer);
        const currentWidth = Math.max(1, rect.right - rect.left);
        const currentHeight = Math.max(1, rect.bottom - rect.top);
        const scaleX = (targetWidth / currentWidth) * 100;
        const scaleY = (targetHeight / currentHeight) * 100;
        const scale = Math.max(1, Math.min(scaleX, scaleY));

        await action.batchPlay([{
            _obj: 'transform',
            _target: [{ _ref: 'layer', _id: layer.id }],
            freeTransformCenterState: { _enum: 'quadCenterState', _value: 'QCSAverage' },
            width: { _unit: 'percentUnit', _value: scale },
            height: { _unit: 'percentUnit', _value: scale },
            interfaceIconFrameDimmed: { _enum: 'interpolationType', _value: 'bicubic' },
            _options: { dialogOptions: 'dontDisplay' }
        }], { synchronousExecution: true });
    }

    private async scaleToRect(layer: any, targetRect: Rect): Promise<void> {
        const targetWidth = Math.max(1, targetRect.right - targetRect.left);
        const targetHeight = Math.max(1, targetRect.bottom - targetRect.top);
        const rect = layerRect(layer);
        const currentWidth = Math.max(1, rect.right - rect.left);
        const currentHeight = Math.max(1, rect.bottom - rect.top);
        const scaleX = (targetWidth / currentWidth) * 100;
        const scaleY = (targetHeight / currentHeight) * 100;

        await action.batchPlay([{
            _obj: 'transform',
            _target: [{ _ref: 'layer', _id: layer.id }],
            freeTransformCenterState: { _enum: 'quadCenterState', _value: 'QCSAverage' },
            width: { _unit: 'percentUnit', _value: Math.max(1, scaleX) },
            height: { _unit: 'percentUnit', _value: Math.max(1, scaleY) },
            interfaceIconFrameDimmed: { _enum: 'interpolationType', _value: 'bicubic' },
            _options: { dialogOptions: 'dontDisplay' }
        }], { synchronousExecution: true });

        const scaledRect = layerRect(layer);
        const moveX = targetRect.left - scaledRect.left;
        const moveY = targetRect.top - scaledRect.top;
        if (Math.abs(moveX) < 0.5 && Math.abs(moveY) < 0.5) {
            return;
        }

        await this.translateLayer(layer, moveX, moveY);
    }

    private async positionPlacedLayer(layer: any, targetRect: Rect, align: 'center' | 'left' | 'right' | 'top' | 'bottom'): Promise<void> {
        const rect = layerRect(layer);
        const layerWidth = Math.max(1, rect.right - rect.left);
        const layerHeight = Math.max(1, rect.bottom - rect.top);
        const currentCenterX = (rect.left + rect.right) / 2;
        const currentCenterY = (rect.top + rect.bottom) / 2;

        let targetCenterX = (targetRect.left + targetRect.right) / 2;
        let targetCenterY = (targetRect.top + targetRect.bottom) / 2;

        if (align === 'left') {
            targetCenterX = targetRect.left + (layerWidth / 2);
        } else if (align === 'right') {
            targetCenterX = targetRect.right - (layerWidth / 2);
        } else if (align === 'top') {
            targetCenterY = targetRect.top + (layerHeight / 2);
        } else if (align === 'bottom') {
            targetCenterY = targetRect.bottom - (layerHeight / 2);
        }

        const moveX = targetCenterX - currentCenterX;
        const moveY = targetCenterY - currentCenterY;
        if (Math.abs(moveX) < 0.5 && Math.abs(moveY) < 0.5) {
            return;
        }

        await this.translateLayer(layer, moveX, moveY);
    }

    private async translateLayer(layer: any, offsetX: number, offsetY: number): Promise<void> {
        if (typeof layer?.translate !== 'function') {
            throw new Error(`DetailPageFiller failed: layer ${layer?.id ?? 'unknown'} does not support DOM translate; native offset move is blocked to avoid Photoshop popups.`);
        }
        await Promise.resolve(layer.translate(offsetX, offsetY));
    }

    private async moveLayerAbove(layer: any, targetLayer: any): Promise<void> {
        if (!layer?.id || !targetLayer?.id) {
            throw new Error('DetailPageFiller failed: cannot reorder placed image because source or target layer is missing.');
        }
        if (typeof layer.move !== 'function') {
            throw new Error(`DetailPageFiller failed: layer ${layer.id} does not support DOM move; native Photoshop move is blocked to avoid popups.`);
        }
        const placement = getPhotoshopElementPlacement(constants, 'PLACEBEFORE', 'DetailPageFiller failed');
        await Promise.resolve(layer.move(targetLayer, placement));
    }

    private async createClippingMask(layer: any): Promise<void> {
        await action.batchPlay([{
            _obj: 'groupEvent',
            _target: [{ _ref: 'layer', _id: layer.id }],
            _options: { dialogOptions: 'dontDisplay' }
        }], { synchronousExecution: true });
    }

    private findLayerById(layers: any, id: number): any {
        if (!layers) return null;
        const list = Array.isArray(layers) ? layers : [layers];
        for (const layer of list) {
            if (layer?.id === id) return layer;
            if (layer?.layers) {
                const found = this.findLayerById(layer.layers, id);
                if (found) return found;
            }
        }
        return null;
    }
}

export class DetailPageFillerTool {
    name = 'fillDetailPage';

    schema = {
        name: 'fillDetailPage',
        description: 'Bulk fill copy and images into detail-page template.',
        parameters: {
            type: 'object' as const,
            properties: {
                plan: {
                    type: 'object',
                    description: 'Single fill plan'
                },
                plans: {
                    type: 'array',
                    description: 'Batch fill plan list'
                }
            },
            required: [] as string[]
        }
    };

    async execute(params: { plan?: FillPlan; plans?: FillPlan[] }): Promise<FillResult | FillResult[]> {
        const filler = new DetailPageFiller();
        if (params.plans) {
            return filler.fillAll(params.plans);
        }
        if (params.plan) {
            return filler.fill(params.plan);
        }
        throw new Error('Missing fill plan');
    }
}
