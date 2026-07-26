import { executeToolCall } from '../tool-executor.service';
import type { SkillExecuteParams } from './types';
import type {
    ReferenceReplicationBlueprint,
    TemplateBlueprintElement
} from '../../../shared/reference-replication-blueprint';
import { normalizeTemplateBlueprintScreenGroups } from '../../../shared/reference-replication-blueprint';
import type { MinimalDesignElementStyle } from '../../../shared/reference-replication';
import {
    buildReferenceReplicationRootGroupName,
    buildReferenceReplicationSurfaceGroupName
} from '../../../shared/reference-replication-output-intent';
import {
    buildReferenceShadowRecipeExecutionPlan,
    buildReferenceStrokeRecipeExecutionPlan
} from '../../../shared/reference-replication-style-recipes';
import {
    buildPlacementPlan,
    type PlacementPlan
} from '../../../shared/reference-replication-placement';
import {
    buildReferenceTextLineLayoutPlan,
    assessTextBoundsFit,
    buildReferenceTextLayerCreateRequest,
    estimateReferenceTextTrackingFit,
    resolveReferenceTextFontSize,
    resolveReferenceTextLeading,
    resolveReferenceTextPlacementRole,
    resolveReferenceTextTracking,
    resolveTextBoundsCorrection
} from './layout-replication-text-placement';

export interface PixelBox {
    left: number;
    top: number;
    width: number;
    height: number;
}

export interface PixelRect {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
}

export interface GeneratedCopyPlaceholder {
    layerId: number;
    layerName: string;
    currentText: string;
    role: 'title' | 'subtitle' | 'body' | 'label' | 'unknown';
    sourceKind?: 'reference' | 'supplemental';
    referenceElementId?: string;
    referenceElementName?: string;
    referenceElementIndex?: number;
    referenceElementRole?: TemplateBlueprintElement['role'];
    bounds: PixelBox;
    actualBounds?: PixelBox;
    boundsVerified?: boolean;
    boundsIssue?: string;
    sizeVerified?: boolean;
    widthDelta?: number;
    heightDelta?: number;
    sizeIssue?: string;
    style?: MinimalDesignElementStyle;
    textLayout?: TemplateBlueprintElement['textLayout'];
    textLinePlan?: {
        lineCount: number;
        insertedLineBreaks: boolean;
        fontSize: number;
        leading?: number;
    };
}

export interface GeneratedImagePlaceholder {
    layerId: number;
    layerName: string;
    sourceKind?: 'reference' | 'supplemental';
    referenceElementId?: string;
    referenceElementName?: string;
    referenceElementIndex?: number;
    referenceElementRole?: TemplateBlueprintElement['role'];
    bounds: PixelBox;
    actualBounds?: PixelBox;
    aspectRatio: number;
    recommendedAssetType: 'product' | 'model' | 'detail' | 'scene' | 'icon';
    placementPlan: PlacementPlan;
    style?: MinimalDesignElementStyle;
}

export interface GeneratedTemplateScreen {
    id: number;
    index: number;
    name: string;
    type: string;
    bounds?: PixelRect;
    copyPlaceholders: GeneratedCopyPlaceholder[];
    imagePlaceholders: GeneratedImagePlaceholder[];
    styleRecipeStats?: StyleRecipeApplicationStats;
}

export interface StyleRecipeApplicationStats {
    attempted: number;
    applied: number;
    failed: number;
    skipped: number;
    notes: string[];
}

export interface GeneratedReferenceElementResult {
    source: 'template-apply';
    referenceElementId: string;
    screenIndex: number;
    elementIndex: number;
    name: string;
    role: TemplateBlueprintElement['role'];
    status: 'applied' | 'failed' | 'skipped';
    layerId?: number;
    reason?: string;
}

interface TextBoundsAlignmentResult {
    actualBounds?: PixelBox;
    verified: boolean;
    moveAttempted: boolean;
    moveSucceeded?: boolean;
    moveAttempts?: number;
    issue?: string;
    sizeVerified?: boolean;
    widthDelta?: number;
    heightDelta?: number;
    sizeIssue?: string;
    trackingAdjusted?: boolean;
    trackingBefore?: number;
    trackingAfter?: number;
    trackingDelta?: number;
    trackingIssue?: string;
}

interface TextBoundsTypographyContext {
    content?: string;
    fontSize?: number;
    tracking?: number;
}

interface SupplementalPlaceholderResult {
    layerId?: number;
    box: PixelBox;
    actualBounds?: PixelBox;
    textAlignment?: TextBoundsAlignmentResult;
}

function clamp(n: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, n));
}

function computePixelBox(element: TemplateBlueprintElement, canvasWidth: number, canvasHeight: number): PixelBox {
    const left = Math.round(clamp(element.x, 0, 1) * canvasWidth);
    const top = Math.round(clamp(element.y, 0, 1) * canvasHeight);
    const width = Math.round(clamp(element.width, 0.02, 1) * canvasWidth);
    const height = Math.round(clamp(element.height, 0.02, 1) * canvasHeight);
    return {
        left: clamp(left, 0, Math.max(0, canvasWidth - 10)),
        top: clamp(top, 0, Math.max(0, canvasHeight - 10)),
        width: clamp(width, 24, Math.max(24, canvasWidth)),
        height: clamp(height, 24, Math.max(24, canvasHeight))
    };
}

function buildReferenceElementId(screenIndex: number, elementIndex: number, element: TemplateBlueprintElement): string {
    return `${screenIndex}:${elementIndex + 1}:${String(element.name || element.role || 'element')}`;
}

function buildAggregateBounds(boxes: PixelBox[], canvasWidth: number, canvasHeight: number): PixelRect | undefined {
    if (boxes.length === 0) return undefined;
    const padding = 24;
    const left = clamp(Math.min(...boxes.map((box) => box.left)) - padding, 0, canvasWidth);
    const top = clamp(Math.min(...boxes.map((box) => box.top)) - padding, 0, canvasHeight);
    const right = clamp(Math.max(...boxes.map((box) => box.left + box.width)) + padding, left + 1, canvasWidth);
    const bottom = clamp(Math.max(...boxes.map((box) => box.top + box.height)) + padding, top + 1, canvasHeight);
    return {
        left: Math.round(left),
        top: Math.round(top),
        right: Math.round(right),
        bottom: Math.round(bottom),
        width: Math.round(right - left),
        height: Math.round(bottom - top)
    };
}

function roleGroupName(role: TemplateBlueprintElement['role']): '文案' | 'icon' | '图片' {
    if (role === 'copy') return '文案';
    if (role === 'icon') return 'icon';
    return '图片';
}

function placeholderColor(role: TemplateBlueprintElement['role']): string {
    if (role === 'icon') return '#BFD7EA';
    if (role === 'image') return '#C7E9B4';
    if (role === 'background') return '#E0E0E0';
    if (role === 'decoration') return '#E8DFF5';
    return '#D9D9D9';
}

function resolveFillColor(element: TemplateBlueprintElement): string {
    return element.style?.fillColor
        || element.style?.strokeColor
        || placeholderColor(element.role);
}

function resolveTextColor(element: TemplateBlueprintElement): string {
    return element.style?.textColor
        || element.style?.fillColor
        || '#333333';
}

function resolveOpacity(element: TemplateBlueprintElement, fallback: number): number {
    if (typeof element.style?.opacity !== 'number' || !Number.isFinite(element.style.opacity)) {
        return fallback;
    }
    return clamp(Math.round(element.style.opacity * 100), 8, 100);
}

function resolveCornerRadius(element: TemplateBlueprintElement, fallback: number): number {
    if (typeof element.style?.cornerRadius !== 'number' || !Number.isFinite(element.style.cornerRadius)) {
        return fallback;
    }
    return clamp(Math.round(element.style.cornerRadius), 0, 80);
}

function recommendAssetTypeByRole(role: TemplateBlueprintElement['role']): 'product' | 'model' | 'detail' | 'scene' | 'icon' {
    if (role === 'icon') return 'icon';
    if (role === 'background') return 'scene';
    if (role === 'image') return 'product';
    if (role === 'decoration') return 'detail';
    return 'product';
}

async function safeRenameLayer(layerId: number | undefined, newName: string): Promise<void> {
    if (!layerId) return;
    try {
        await executeToolCall('renameLayer', { layerId, newName });
    } catch {
        // Non-blocking.
    }
}

function normalizeToolBoundsToPixelBox(bounds: any): PixelBox | undefined {
    if (!bounds || typeof bounds !== 'object') return undefined;
    const left = Number(bounds.left);
    const top = Number(bounds.top);
    const right = Number(bounds.right);
    const bottom = Number(bounds.bottom);
    const width = Number(bounds.width);
    const height = Number(bounds.height);

    if (Number.isFinite(left) && Number.isFinite(top) && Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
        return {
            left: Math.round(left),
            top: Math.round(top),
            width: Math.round(width),
            height: Math.round(height)
        };
    }

    if (Number.isFinite(left) && Number.isFinite(top) && Number.isFinite(right) && Number.isFinite(bottom) && right > left && bottom > top) {
        return {
            left: Math.round(left),
            top: Math.round(top),
            width: Math.round(right - left),
            height: Math.round(bottom - top)
        };
    }

    return undefined;
}

async function readLayerActualPixelBox(layerId: number | undefined): Promise<PixelBox | undefined> {
    if (!layerId) return undefined;
    try {
        const result = await executeToolCall('getLayerBounds', { layerId });
        if (!result?.success) return undefined;
        return normalizeToolBoundsToPixelBox(result.boundsNoEffects || result.bounds);
    } catch {
        return undefined;
    }
}

function wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readLayerActualPixelBoxStable(layerId: number | undefined, attempts = 4): Promise<PixelBox | undefined> {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        const box = await readLayerActualPixelBox(layerId);
        if (box) return box;
        if (attempt < attempts) {
            await wait(100 * attempt);
        }
    }
    return undefined;
}

async function applyTextTrackingWidthFit(input: {
    layerId: number;
    targetBox: PixelBox;
    actualBounds: PixelBox;
    typography?: TextBoundsTypographyContext;
    callbacks: SkillExecuteParams['callbacks'];
}): Promise<{
    actualBounds: PixelBox;
    trackingAdjusted: boolean;
    trackingBefore?: number;
    trackingAfter?: number;
    trackingDelta?: number;
    trackingIssue?: string;
}> {
    const trackingAdjustment = estimateReferenceTextTrackingFit({
        content: input.typography?.content,
        fontSize: input.typography?.fontSize,
        targetBox: input.targetBox,
        actualBox: input.actualBounds,
        currentTracking: input.typography?.tracking
    });
    if (!trackingAdjustment) {
        return {
            actualBounds: input.actualBounds,
            trackingAdjusted: false
        };
    }

    const trackingBefore = typeof input.typography?.tracking === 'number' && Number.isFinite(input.typography.tracking)
        ? Math.round(input.typography.tracking)
        : 0;
    input.callbacks?.onToolStart?.('setTextStyle');
    const styleParams: Record<string, number> = {
        layerId: input.layerId,
        tracking: trackingAdjustment.tracking
    };
    if (typeof input.typography?.fontSize === 'number' && Number.isFinite(input.typography.fontSize) && input.typography.fontSize > 0) {
        styleParams.fontSize = Math.round(input.typography.fontSize);
    }
    const styleResult = await executeToolCall('setTextStyle', {
        ...styleParams
    });
    input.callbacks?.onToolComplete?.('setTextStyle', styleResult);

    if (styleResult?.success === false) {
        return {
            actualBounds: input.actualBounds,
            trackingAdjusted: false,
            trackingBefore,
            trackingAfter: trackingAdjustment.tracking,
            trackingDelta: trackingAdjustment.trackingDelta,
            trackingIssue: styleResult?.error || 'setTextStyle failed during text width fitting'
        };
    }

    await wait(120);
    let actualBounds = await readLayerActualPixelBoxStable(input.layerId);
    if (!actualBounds) {
        return {
            actualBounds: input.actualBounds,
            trackingAdjusted: true,
            trackingBefore,
            trackingAfter: trackingAdjustment.tracking,
            trackingDelta: trackingAdjustment.trackingDelta,
            trackingIssue: 'unable to read text bounds after tracking adjustment'
        };
    }

    const correction = resolveTextBoundsCorrection({
        targetBox: input.targetBox,
        actualBox: actualBounds,
        tolerancePx: 2
    });
    if (correction.shouldMove) {
        input.callbacks?.onToolStart?.('moveLayer');
        const moveResult = await executeToolCall('moveLayer', {
            layerId: input.layerId,
            x: correction.dx,
            y: correction.dy,
            relative: true
        });
        input.callbacks?.onToolComplete?.('moveLayer', moveResult);
        if (moveResult?.success !== false) {
            actualBounds = await readLayerActualPixelBoxStable(input.layerId) || actualBounds;
        }
    }

    return {
        actualBounds,
        trackingAdjusted: true,
        trackingBefore,
        trackingAfter: trackingAdjustment.tracking,
        trackingDelta: trackingAdjustment.trackingDelta
    };
}

async function alignLayerBoundsToTargetBox(
    layerId: number | undefined,
    targetBox: PixelBox,
    callbacks: SkillExecuteParams['callbacks'],
    typography?: TextBoundsTypographyContext
): Promise<TextBoundsAlignmentResult> {
    if (!layerId) {
        return {
            verified: false,
            moveAttempted: false,
            issue: 'missing layer id'
        };
    }
    const before = await readLayerActualPixelBoxStable(layerId);
    if (!before) {
        return {
            verified: false,
            moveAttempted: false,
            issue: 'unable to read text layer bounds before alignment'
        };
    }
    const correction = resolveTextBoundsCorrection({
        targetBox,
        actualBox: before,
        tolerancePx: 1
    });
    let actualBounds = before;
    let residual = correction;
    let moveAttempts = 0;

    while (residual.shouldMove && moveAttempts < 2) {
        callbacks?.onToolStart?.('moveLayer');
        const moveResult = await executeToolCall('moveLayer', {
            layerId,
            x: residual.dx,
            y: residual.dy,
            relative: true
        });
        callbacks?.onToolComplete?.('moveLayer', moveResult);
        moveAttempts += 1;

        if (moveResult?.success === false) {
            return {
                actualBounds,
                verified: false,
                moveAttempted: true,
                moveSucceeded: false,
                moveAttempts,
                issue: moveResult?.error || 'moveLayer failed during text bounds alignment'
            };
        }

        const after = await readLayerActualPixelBoxStable(layerId);
        if (!after) {
            return {
                actualBounds,
                verified: false,
                moveAttempted: true,
                moveSucceeded: true,
                moveAttempts,
                issue: 'unable to read text layer bounds after alignment'
            };
        }

        actualBounds = after;
        residual = resolveTextBoundsCorrection({
            targetBox,
            actualBox: after,
            tolerancePx: 2
        });
    }

    let trackingResult: Awaited<ReturnType<typeof applyTextTrackingWidthFit>> | undefined;
    if (!residual.shouldMove) {
        trackingResult = await applyTextTrackingWidthFit({
            layerId,
            targetBox,
            actualBounds,
            typography,
            callbacks
        });
        actualBounds = trackingResult.actualBounds;
        residual = resolveTextBoundsCorrection({
            targetBox,
            actualBox: actualBounds,
            tolerancePx: 2
        });
    }

    const fit = assessTextBoundsFit({
        targetBox,
        actualBox: actualBounds
    });
    return {
        actualBounds,
        verified: !residual.shouldMove,
        moveAttempted: correction.shouldMove,
        moveSucceeded: correction.shouldMove ? true : undefined,
        moveAttempts,
        sizeVerified: fit.sizeVerified,
        widthDelta: fit.widthDelta,
        heightDelta: fit.heightDelta,
        sizeIssue: fit.issue,
        trackingAdjusted: trackingResult?.trackingAdjusted,
        trackingBefore: trackingResult?.trackingBefore,
        trackingAfter: trackingResult?.trackingAfter,
        trackingDelta: trackingResult?.trackingDelta,
        trackingIssue: trackingResult?.trackingIssue,
        issue: residual.shouldMove
            ? `text bounds still drift after alignment: dx=${residual.dx}, dy=${residual.dy}`
            : undefined
    };
}

function createStyleRecipeStats(): StyleRecipeApplicationStats {
    return {
        attempted: 0,
        applied: 0,
        failed: 0,
        skipped: 0,
        notes: []
    };
}

function mergeStyleRecipeStats(target: StyleRecipeApplicationStats, source?: StyleRecipeApplicationStats): void {
    if (!source) return;
    target.attempted += source.attempted;
    target.applied += source.applied;
    target.failed += source.failed;
    target.skipped += source.skipped;
    for (const note of source.notes) {
        if (target.notes.length >= 12) break;
        target.notes.push(note);
    }
}

async function applyStyleRecipesToLayer(
    layerId: number | undefined,
    layerName: string,
    style: MinimalDesignElementStyle | undefined,
    bounds: PixelBox,
    callbacks: SkillExecuteParams['callbacks']
): Promise<StyleRecipeApplicationStats | undefined> {
    if (!layerId || !style) return undefined;

    const recipePlans = [
        {
            toolName: 'addDropShadow',
            plan: buildReferenceShadowRecipeExecutionPlan(style, bounds)
        },
        {
            toolName: 'addStroke',
            plan: buildReferenceStrokeRecipeExecutionPlan(style, bounds)
        }
    ].filter((item) => !!item.plan);

    if (!recipePlans.length) return undefined;

    const stats = createStyleRecipeStats();

    for (const item of recipePlans) {
        const plan = item.plan!;
        stats.attempted += 1;

        if (!plan.executable || !plan.params) {
            stats.skipped += 1;
            stats.notes.push(`${layerName}: ${plan.reason}`);
            continue;
        }

        callbacks?.onToolStart?.(item.toolName);
        const result = await executeToolCall(item.toolName, {
            layerId,
            ...plan.params
        });

        if (result?.success) {
            stats.applied += 1;
            callbacks?.onToolComplete?.(item.toolName, result);
        } else {
            stats.failed += 1;
            stats.notes.push(`${layerName}: ${item.toolName} failed${result?.error ? ` - ${result.error}` : ''}`);
        }
    }

    return stats;
}

async function createSupplementalPlaceholderByRole(
    role: '文案' | 'icon' | '图片',
    screenIndex: number,
    surfaceLabel: string,
    canvasWidth: number,
    canvasHeight: number,
    callbacks: SkillExecuteParams['callbacks']
): Promise<SupplementalPlaceholderResult> {
    if (role === '文案') {
        const content = `[文案占位] ${surfaceLabel}`;
        const box: PixelBox = {
            left: 24,
            top: 24,
            width: Math.round(canvasWidth * 0.7),
            height: Math.round(canvasHeight * 0.1)
        };
        const fontSize = resolveReferenceTextFontSize({
            box,
            canvasHeight,
            role: 'title',
            content
        });
        const textCreateRequest = buildReferenceTextLayerCreateRequest({
            content,
            box,
            fontSize,
            colorHex: '#444444'
        });
        const textResult = await executeToolCall('createTextLayer', {
            ...textCreateRequest,
            name: `文案_占位_${screenIndex}`
        });
        const layerId = textResult?.layerId as number | undefined;
        await safeRenameLayer(layerId, `文案_占位_${screenIndex}`);
        const textAlignment = await alignLayerBoundsToTargetBox(layerId, box, callbacks, {
            content,
            fontSize
        });
        return {
            layerId,
            box,
            actualBounds: textAlignment.actualBounds,
            textAlignment
        };
    }

    const box: PixelBox = {
        left: Math.round(canvasWidth * (role === 'icon' ? 0.05 : 0.1)),
        top: Math.round(canvasHeight * (role === 'icon' ? 0.12 : 0.18)),
        width: Math.round(canvasWidth * (role === 'icon' ? 0.12 : 0.7)),
        height: Math.round(canvasHeight * (role === 'icon' ? 0.08 : 0.24))
    };
    const shapeResult = await executeToolCall('createRectangle', {
        name: `${role}_占位_${screenIndex}`,
        x: box.left,
        y: box.top,
        width: box.width,
        height: box.height,
        fillColorHex: role === 'icon' ? '#BFD7EA' : '#C7E9B4',
        cornerRadius: role === 'icon' ? 18 : 8
    });
    const layerId = shapeResult?.layerId as number | undefined;
    if (layerId) {
        await executeToolCall('setLayerOpacity', { layerId, opacity: 28 });
    }
    return {
        layerId,
        box,
        actualBounds: await readLayerActualPixelBox(layerId)
    };
}

export async function applyTemplateBlueprintToDocument(
    blueprint: ReferenceReplicationBlueprint,
    canvas: { width: number; height: number },
    callbacks: SkillExecuteParams['callbacks'],
    signal?: AbortSignal
): Promise<{
    success: boolean;
    screenCount: number;
    surfaceCount: number;
    createdLayers: number;
    rootGroupName?: string;
    failedOps: number;
    styleRecipeStats: StyleRecipeApplicationStats;
    elementResults: GeneratedReferenceElementResult[];
    generatedScreens: GeneratedTemplateScreen[];
    outputIntent: ReferenceReplicationBlueprint['outputIntent'];
}> {
    const outputIntent = blueprint.outputIntent;
    const screenGroupIds: number[] = [];
    const generatedScreens: GeneratedTemplateScreen[] = [];
    const elementResults: GeneratedReferenceElementResult[] = [];
    const totalStyleRecipeStats = createStyleRecipeStats();
    let createdLayers = 0;
    let failedOps = 0;

    for (const screen of blueprint.screens) {
        if (signal?.aborted) {
            return {
                success: false,
                screenCount: screenGroupIds.length,
                surfaceCount: screenGroupIds.length,
                createdLayers,
                failedOps,
                styleRecipeStats: totalStyleRecipeStats,
                elementResults,
                rootGroupName: undefined,
                generatedScreens,
                outputIntent
            };
        }

        callbacks?.onMessage?.(
            outputIntent.topology === 'multi_screen'
                ? `生成模板骨架: 第${screen.index}屏 ${screen.type}`
                : `生成${outputIntent.artifactLabel}复刻骨架: ${outputIntent.surfaceLabel}`
        );

        const roleLayerMap: Record<'文案' | 'icon' | '图片', number[]> = {
            文案: [],
            icon: [],
            图片: []
        };
        const generatedCopyPlaceholders: GeneratedCopyPlaceholder[] = [];
        const generatedImagePlaceholders: GeneratedImagePlaceholder[] = [];
        const screenStyleRecipeStats = createStyleRecipeStats();

        for (let i = 0; i < screen.elements.length; i++) {
            const element = screen.elements[i];
            const group = roleGroupName(element.role);
            const box = computePixelBox(element, canvas.width, canvas.height);
            const referenceElementId = buildReferenceElementId(screen.index, i, element);
            const referenceMeta = {
                source: 'template-apply' as const,
                referenceElementId,
                screenIndex: screen.index,
                elementIndex: i + 1,
                name: element.name,
                role: element.role
            };

            try {
                if (element.role === 'copy') {
                    const content = String(element.content || '').trim() || `[文案] ${screen.type}`;
                    const copyRole = resolveReferenceTextPlacementRole({
                        content,
                        name: element.name,
                        style: element.style
                    });
                    const textLinePlan = buildReferenceTextLineLayoutPlan({
                        content,
                        box,
                        canvasHeight: canvas.height,
                        role: copyRole,
                        style: element.style
                    });
                    const fontSize = textLinePlan.fontSize || resolveReferenceTextFontSize({
                        style: element.style,
                        box,
                        canvasHeight: canvas.height,
                        role: copyRole,
                        content
                    });
                    const tracking = resolveReferenceTextTracking(element.style);
                    const leading = textLinePlan.leading || resolveReferenceTextLeading({
                        style: element.style,
                        fontSize
                    });
                    const layerName = `文案_${screen.index}_${i + 1}`;
                    const textCreateRequest = buildReferenceTextLayerCreateRequest({
                        content: textLinePlan.content || content,
                        box,
                        fontSize,
                        colorHex: resolveTextColor(element),
                        tracking,
                        leading,
                        alignment: element.textLayout?.textAlign || 'left'
                    });
                    const textResult = await executeToolCall('createTextLayer', {
                        ...textCreateRequest,
                        name: layerName
                    });
                    const layerId = textResult?.layerId as number | undefined;
                    await safeRenameLayer(layerId, `文案_${screen.index}_${i + 1}`);
                    if (layerId) {
                        const textAlignment = await alignLayerBoundsToTargetBox(layerId, box, callbacks, {
                            content: textLinePlan.content || content,
                            fontSize,
                            tracking
                        });
                        if (!textAlignment.verified) {
                            failedOps++;
                            if (textAlignment.issue && screenStyleRecipeStats.notes.length < 12) {
                                screenStyleRecipeStats.notes.push(`${layerName}: ${textAlignment.issue}`);
                            }
                        }
                        const styleStats = await applyStyleRecipesToLayer(layerId, layerName, element.style, box, callbacks);
                        mergeStyleRecipeStats(screenStyleRecipeStats, styleStats);
                        if (styleStats && (styleStats.failed > 0 || styleStats.skipped > 0)) {
                            failedOps += styleStats.failed + styleStats.skipped;
                        }
                        generatedCopyPlaceholders.push({
                            layerId,
                            layerName,
                            currentText: textLinePlan.content || content,
                            role: copyRole,
                            sourceKind: 'reference',
                            referenceElementId,
                            referenceElementName: element.name,
                            referenceElementIndex: i + 1,
                            referenceElementRole: element.role,
                            bounds: box,
                            actualBounds: textAlignment.actualBounds,
                            boundsVerified: textAlignment.verified,
                            boundsIssue: textAlignment.issue,
                            sizeVerified: textAlignment.sizeVerified,
                            widthDelta: textAlignment.widthDelta,
                            heightDelta: textAlignment.heightDelta,
                            sizeIssue: textAlignment.sizeIssue,
                            style: element.style,
                            textLayout: element.textLayout,
                            textLinePlan: {
                                lineCount: textLinePlan.lineCount,
                                insertedLineBreaks: textLinePlan.insertedLineBreaks,
                                fontSize: textLinePlan.fontSize,
                                leading: textLinePlan.leading
                            }
                        });
                        roleLayerMap[group].push(layerId);
                        createdLayers++;
                        elementResults.push({
                            ...referenceMeta,
                            status: 'applied',
                            layerId
                        });
                    } else {
                        failedOps++;
                        elementResults.push({
                            ...referenceMeta,
                            status: 'failed',
                            reason: 'createTextLayer returned no layerId'
                        });
                    }
                } else {
                    const layerName = `${group}_${screen.index}_${i + 1}`;
                    const shapeResult = await executeToolCall('createRectangle', {
                        name: layerName,
                        x: box.left,
                        y: box.top,
                        width: box.width,
                        height: box.height,
                        fillColorHex: resolveFillColor(element),
                        cornerRadius: resolveCornerRadius(element, group === 'icon' ? 16 : 6)
                    });
                    const layerId = shapeResult?.layerId as number | undefined;
                    if (layerId) {
                        const styleStats = await applyStyleRecipesToLayer(layerId, layerName, element.style, box, callbacks);
                        mergeStyleRecipeStats(screenStyleRecipeStats, styleStats);
                        if (styleStats && (styleStats.failed > 0 || styleStats.skipped > 0)) {
                            failedOps += styleStats.failed + styleStats.skipped;
                        }
                        generatedImagePlaceholders.push({
                            layerId,
                            layerName,
                            sourceKind: 'reference',
                            referenceElementId,
                            referenceElementName: element.name,
                            referenceElementIndex: i + 1,
                            referenceElementRole: element.role,
                            bounds: box,
                            actualBounds: await readLayerActualPixelBox(layerId),
                            aspectRatio: box.width > 0 && box.height > 0 ? box.width / box.height : 1,
                            recommendedAssetType: recommendAssetTypeByRole(element.role),
                            style: element.style,
                            placementPlan: buildPlacementPlan({
                                elementId: layerName,
                                targetBox: {
                                    x: box.left,
                                    y: box.top,
                                    width: box.width,
                                    height: box.height
                                },
                                assetKind: recommendAssetTypeByRole(element.role)
                            })
                        });
                        await executeToolCall('setLayerOpacity', { layerId, opacity: resolveOpacity(element, group === 'icon' ? 35 : 26) });
                        roleLayerMap[group].push(layerId);
                        createdLayers++;
                        elementResults.push({
                            ...referenceMeta,
                            status: 'applied',
                            layerId
                        });
                    } else {
                        failedOps++;
                        elementResults.push({
                            ...referenceMeta,
                            status: 'failed',
                            reason: 'createRectangle returned no layerId'
                        });
                    }
                }
            } catch (error: any) {
                failedOps++;
                elementResults.push({
                    ...referenceMeta,
                    status: 'failed',
                    reason: error?.message || 'reference element tool execution failed'
                });
            }
        }

        const requiredGroups = normalizeTemplateBlueprintScreenGroups(screen);
        for (const requiredRole of requiredGroups) {
            if (roleLayerMap[requiredRole].length === 0) {
                const supplemental = await createSupplementalPlaceholderByRole(
                    requiredRole,
                    screen.index,
                    outputIntent.surfaceLabel,
                    canvas.width,
                    canvas.height,
                    callbacks
                );
                const supplementalLayerId = supplemental.layerId;
                if (supplementalLayerId) {
                    if (requiredRole === '文案') {
                        if (supplemental.textAlignment && !supplemental.textAlignment.verified) {
                            failedOps++;
                            if (supplemental.textAlignment.issue && screenStyleRecipeStats.notes.length < 12) {
                                screenStyleRecipeStats.notes.push(`文案_占位_${screen.index}: ${supplemental.textAlignment.issue}`);
                            }
                        }
                        generatedCopyPlaceholders.push({
                            layerId: supplementalLayerId,
                            layerName: `文案_占位_${screen.index}`,
                            currentText: `[文案占位] ${outputIntent.surfaceLabel}`,
                            role: 'title',
                            sourceKind: 'supplemental',
                            bounds: supplemental.box,
                            actualBounds: supplemental.actualBounds,
                            boundsVerified: supplemental.textAlignment?.verified,
                            boundsIssue: supplemental.textAlignment?.issue,
                            sizeVerified: supplemental.textAlignment?.sizeVerified,
                            widthDelta: supplemental.textAlignment?.widthDelta,
                            heightDelta: supplemental.textAlignment?.heightDelta,
                            sizeIssue: supplemental.textAlignment?.sizeIssue
                        });
                    } else {
                        const isIcon = requiredRole === 'icon';
                        generatedImagePlaceholders.push({
                            layerId: supplementalLayerId,
                            layerName: `${requiredRole}_占位_${screen.index}`,
                            sourceKind: 'supplemental',
                            bounds: supplemental.box,
                            actualBounds: supplemental.actualBounds,
                            aspectRatio: supplemental.box.width > 0 && supplemental.box.height > 0 ? supplemental.box.width / supplemental.box.height : 1,
                            recommendedAssetType: isIcon ? 'icon' : 'product',
                            placementPlan: buildPlacementPlan({
                                elementId: `${requiredRole}_占位_${screen.index}`,
                                targetBox: {
                                    x: supplemental.box.left,
                                    y: supplemental.box.top,
                                    width: supplemental.box.width,
                                    height: supplemental.box.height
                                },
                                assetKind: isIcon ? 'icon' : 'product'
                            })
                        });
                    }
                    roleLayerMap[requiredRole].push(supplementalLayerId);
                    createdLayers++;
                } else {
                    failedOps++;
                }
            }
        }

        const roleGroupIds: number[] = [];
        for (const role of ['文案', 'icon', '图片'] as const) {
            const ids = roleLayerMap[role];
            if (ids.length === 0) continue;
            const grouped = await executeToolCall('groupLayers', {
                layerIds: ids,
                groupName: role
            });
            const groupId = grouped?.group?.id as number | undefined;
            if (groupId) {
                roleGroupIds.push(groupId);
            } else {
                failedOps++;
            }
        }

        const surfaceGroupName = buildReferenceReplicationSurfaceGroupName(outputIntent, screen);
        let currentScreenId = screen.index;
        if (roleGroupIds.length > 0) {
            const screenGroupResult = await executeToolCall('groupLayers', {
                layerIds: roleGroupIds,
                groupName: surfaceGroupName
            });
            const screenGroupId = screenGroupResult?.group?.id as number | undefined;
            if (screenGroupId) {
                currentScreenId = screenGroupId;
                screenGroupIds.push(screenGroupId);
            } else {
                failedOps++;
            }
        }

        generatedScreens.push({
            id: currentScreenId,
            index: screen.index,
            name: surfaceGroupName,
            type: screen.type,
            bounds: buildAggregateBounds(
                [
                    ...generatedCopyPlaceholders.map((item) => item.actualBounds || item.bounds),
                    ...generatedImagePlaceholders.map((item) => item.actualBounds || item.bounds)
                ],
                canvas.width,
                canvas.height
            ),
            copyPlaceholders: generatedCopyPlaceholders,
            imagePlaceholders: generatedImagePlaceholders,
            styleRecipeStats: screenStyleRecipeStats.attempted > 0 ? screenStyleRecipeStats : undefined
        });
        mergeStyleRecipeStats(totalStyleRecipeStats, screenStyleRecipeStats);
    }

    let rootGroupName: string | undefined;
    if (screenGroupIds.length > 0) {
        rootGroupName = buildReferenceReplicationRootGroupName(outputIntent);
        const root = await executeToolCall('groupLayers', {
            layerIds: screenGroupIds,
            groupName: rootGroupName
        });
        if (!root?.success) {
            failedOps++;
        }
    }

    return {
        success: failedOps === 0 && createdLayers > 0,
        screenCount: blueprint.screens.length,
        surfaceCount: blueprint.screens.length,
        createdLayers,
        rootGroupName,
        failedOps,
        styleRecipeStats: totalStyleRecipeStats,
        elementResults,
        generatedScreens,
        outputIntent
    };
}
