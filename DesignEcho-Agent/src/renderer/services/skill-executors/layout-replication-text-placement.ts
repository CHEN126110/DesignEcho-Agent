import type { MinimalDesignElementStyle } from '../../../shared/reference-replication';
import type { PixelBox } from './layout-replication-apply';

export type ReferenceTextPlacementRole = 'title' | 'subtitle' | 'body' | 'label' | 'unknown';

export type ReferenceTextLayerCreateRequest = {
    content: string;
    x: number;
    y: number;
    fontSize: number;
    colorHex: string;
    tracking?: number;
    leading?: number;
    alignment?: 'left' | 'center' | 'right';
};

export type ReferenceTextLineLayoutPlan = {
    originalContent: string;
    content: string;
    lines: string[];
    lineCount: number;
    insertedLineBreaks: boolean;
    fontSize: number;
    leading?: number;
    maxLineUnits: number;
    widthFitFontSize: number;
    heightFitFontSize: number;
};

export type ReferenceTextBoundsFit = {
    widthDelta: number;
    heightDelta: number;
    widthRatio: number | null;
    heightRatio: number | null;
    sizeVerified: boolean;
    issue?: string;
};

export type ReferenceTextTrackingFit = {
    tracking: number;
    trackingDelta: number;
    widthDelta: number;
    estimatedGapCount: number;
};

function clamp(n: number, min: number, max: number): number {
    if (!Number.isFinite(n)) return min;
    return Math.max(min, Math.min(max, n));
}

function normalizeTextContent(content?: string): string {
    return String(content || '').replace(/\r\n?/g, '\n').trim();
}

function hasExplicitLineBreak(content: string): boolean {
    return /\n/.test(content);
}

function splitExistingLines(content: string): string[] {
    return content.split('\n').map(line => line.trim()).filter(Boolean);
}

function isCjkPunctuation(char: string): boolean {
    return /[，。；：、！？,.!?;:)]/.test(char);
}

function splitTextIntoBalancedLines(content: string, lineCount: number): string[] {
    const normalized = normalizeTextContent(content);
    if (lineCount <= 1 || !normalized) return [normalized];

    const chars = Array.from(normalized);
    const totalUnits = estimateReferenceTextWidthUnits(normalized);
    const lines: string[] = [];
    let current = '';
    let currentUnits = 0;
    let remainingUnits = totalUnits;
    let remainingLines = lineCount;

    for (let index = 0; index < chars.length; index += 1) {
        const char = chars[index];
        const charUnits = estimateReferenceTextWidthUnits(char);
        current += char;
        currentUnits += charUnits;
        remainingUnits -= charUnits;

        const charsLeft = chars.length - index - 1;
        if (remainingLines <= 1 || charsLeft <= 0) {
            continue;
        }

        const targetUnits = remainingUnits > 0
            ? (currentUnits + remainingUnits) / remainingLines
            : currentUnits;
        const enoughForRemainingLines = charsLeft >= remainingLines - 1;
        const nextChar = chars[index + 1] || '';
        if (
            enoughForRemainingLines &&
            currentUnits >= targetUnits &&
            !isCjkPunctuation(nextChar)
        ) {
            lines.push(current.trim());
            current = '';
            currentUnits = 0;
            remainingLines -= 1;
        }
    }

    if (current.trim()) {
        lines.push(current.trim());
    }

    return lines.filter(Boolean).slice(0, lineCount);
}

function estimateMaxLineUnits(lines: string[]): number {
    return Math.max(1, ...lines.map(line => estimateReferenceTextWidthUnits(line)));
}

function resolveLinePlanCandidateCount(input: {
    content: string;
    box: PixelBox;
    role?: ReferenceTextPlacementRole;
}): number {
    const content = normalizeTextContent(input.content);
    const role = input.role || 'unknown';
    const units = estimateReferenceTextWidthUnits(content);
    const minReadableFontSize = role === 'title' ? 16 : 10;
    const maxByHeight = Math.max(1, Math.floor((Number(input.box.height) || 0) / (minReadableFontSize * 1.15)));
    const maxByContent = Math.max(1, Math.ceil(units / 10));

    if (hasExplicitLineBreak(content)) {
        return splitExistingLines(content).length;
    }
    if (units < 18) {
        return 1;
    }
    if (role === 'label' && units < 34) {
        return 1;
    }

    return Math.round(clamp(Math.min(maxByHeight, maxByContent, 6), 1, 6));
}

function resolveStyleFontSize(style: MinimalDesignElementStyle | undefined, canvasHeight: number): number | undefined {
    if (typeof style?.fontSizeRatio !== 'number' || !Number.isFinite(style.fontSizeRatio) || style.fontSizeRatio <= 0) {
        return undefined;
    }
    return Math.round(clamp(style.fontSizeRatio * canvasHeight, 1, 400));
}

export function resolveReferenceTextPlacementRole(input: {
    content?: string;
    name?: string;
    style?: MinimalDesignElementStyle;
}): ReferenceTextPlacementRole {
    const content = String(input.content || '').trim();
    const name = String(input.name || '').trim().toLowerCase();
    const hasFieldDelimiter = /[:：]/.test(content);
    const hasPriceSignal = /价格|price|¥|￥|元/.test(content.toLowerCase());

    if (hasFieldDelimiter || hasPriceSignal) {
        return 'label';
    }
    if (/subtitle|sub-title|副标题/.test(name)) {
        return 'subtitle';
    }
    if (/title|headline|main-title|主标题|标题/.test(name)) {
        return 'title';
    }
    if (/body|copy|text|field|description|standard|正文|说明|参数/.test(name)) {
        return 'body';
    }
    if (
        typeof input.style?.fontWeight === 'string' &&
        /bold|black|heavy|粗|黑/.test(input.style.fontWeight.toLowerCase()) &&
        content.length <= 16
    ) {
        return 'title';
    }
    if (content.length <= 12) return 'title';
    if (content.length <= 24) return 'subtitle';
    if (content.length > 32) return 'body';
    return 'unknown';
}

export function resolveReferenceTextFontSize(input: {
    style?: MinimalDesignElementStyle;
    box: PixelBox;
    canvasHeight: number;
    role?: ReferenceTextPlacementRole;
    content?: string;
}): number {
    const boxHeight = Math.max(1, Number(input.box.height) || 1);
    const role = input.role || 'unknown';
    const ratio = role === 'title' ? 1.07 : role === 'subtitle' ? 1.05 : 1.1;
    const boxDerivedFontSize = Math.round(boxHeight * ratio);
    let resolvedFontSize = boxDerivedFontSize;

    if (typeof input.style?.fontSizeRatio === 'number' && input.style.fontSizeRatio > 0) {
        const styleFontSize = Math.round(input.style.fontSizeRatio * input.canvasHeight);
        resolvedFontSize = Math.max(styleFontSize, boxDerivedFontSize);
    }

    const widthFitFontSize = resolveReferenceTextWidthFitFontSize({
        content: input.content,
        boxWidth: input.box.width
    });
    if (typeof widthFitFontSize === 'number') {
        resolvedFontSize = Math.min(resolvedFontSize, widthFitFontSize);
    }

    return clamp(Math.round(resolvedFontSize), role === 'title' ? 16 : 10, 160);
}

export function estimateReferenceTextWidthUnits(content?: string): number {
    const lines = String(content || '').split(/\r?\n/);
    const lineUnits = lines.map((line) => {
        let units = 0;
        for (const char of Array.from(line)) {
            if (/[\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/.test(char)) {
                units += 1;
            } else if (/[A-Z]/.test(char)) {
                units += 0.62;
            } else if (/[a-z0-9]/.test(char)) {
                units += 0.56;
            } else if (/[%￥¥$]/.test(char)) {
                units += 0.65;
            } else if (/[:：,，.。;]/.test(char)) {
                units += 0.3;
            } else if (/[-/\\]/.test(char)) {
                units += 0.35;
            } else if (/\s/.test(char)) {
                units += 0.3;
            } else {
                units += 0.55;
            }
        }
        return units;
    });
    return Math.max(1, ...lineUnits);
}

export function resolveReferenceTextWidthFitFontSize(input: {
    content?: string;
    boxWidth: number;
}): number | undefined {
    const boxWidth = Number(input.boxWidth);
    if (!Number.isFinite(boxWidth) || boxWidth <= 0 || !String(input.content || '').trim()) {
        return undefined;
    }
    const widthUnits = estimateReferenceTextWidthUnits(input.content);
    // Slightly relax the cap because Photoshop glyph metrics can be narrower
    // than the generic CJK/Latin estimate, but still prevent obvious overflow.
    return Math.round((boxWidth / widthUnits) * 1.03);
}

export function resolveReferenceTextTracking(style?: MinimalDesignElementStyle): number | undefined {
    if (typeof style?.tracking !== 'number' || !Number.isFinite(style.tracking)) {
        return undefined;
    }
    return Math.round(clamp(style.tracking, -1000, 1000));
}

export function estimateReferenceTextTrackingFit(input: {
    content?: string;
    fontSize?: number;
    targetBox: PixelBox;
    actualBox?: PixelBox;
    currentTracking?: number;
    maxAbsTracking?: number;
}): ReferenceTextTrackingFit | undefined {
    const content = String(input.content || '').trim();
    const fontSize = Number(input.fontSize);
    const actualBox = input.actualBox;
    const targetWidth = Number(input.targetBox.width);
    const targetHeight = Number(input.targetBox.height);
    if (
        !content ||
        /\r|\n/.test(content) ||
        !actualBox ||
        !Number.isFinite(fontSize) ||
        fontSize <= 0 ||
        !Number.isFinite(targetWidth) ||
        targetWidth <= 0 ||
        !Number.isFinite(actualBox.width) ||
        actualBox.width <= 0
    ) {
        return undefined;
    }

    const widthDelta = Math.round(targetWidth - actualBox.width);
    const maxWidthDelta = Math.max(8, Math.min(36, targetWidth * 0.12));
    if (Math.abs(widthDelta) < 4 || Math.abs(widthDelta) > maxWidthDelta) {
        return undefined;
    }

    const heightDelta = Math.round(Number(actualBox.height) - targetHeight);
    const maxHeightDelta = Math.max(8, targetHeight * 0.45);
    if (Number.isFinite(targetHeight) && targetHeight > 0 && Math.abs(heightDelta) > maxHeightDelta) {
        return undefined;
    }

    const glyphCount = Array.from(content).length;
    if (glyphCount < 4) return undefined;

    const estimatedGapCount = Math.max(1, glyphCount - 1);
    const trackingDelta = Math.round((widthDelta * 1000) / (fontSize * estimatedGapCount));
    if (!Number.isFinite(trackingDelta) || Math.abs(trackingDelta) < 2) {
        return undefined;
    }

    const currentTracking = typeof input.currentTracking === 'number' && Number.isFinite(input.currentTracking)
        ? input.currentTracking
        : 0;
    const maxAbsTracking = Math.max(20, Math.min(240, Number(input.maxAbsTracking ?? 160) || 160));
    const tracking = Math.round(clamp(currentTracking + trackingDelta, -maxAbsTracking, maxAbsTracking));
    if (tracking === Math.round(currentTracking)) {
        return undefined;
    }

    return {
        tracking,
        trackingDelta: tracking - Math.round(currentTracking),
        widthDelta,
        estimatedGapCount
    };
}

export function resolveReferenceTextLeading(input: {
    style?: MinimalDesignElementStyle;
    fontSize: number;
}): number | undefined {
    if (typeof input.style?.leading === 'number' && Number.isFinite(input.style.leading) && input.style.leading > 0) {
        return Math.round(clamp(input.style.leading, 1, 400));
    }
    if (
        typeof input.style?.lineHeightRatio === 'number' &&
        Number.isFinite(input.style.lineHeightRatio) &&
        input.style.lineHeightRatio > 0
    ) {
        return Math.round(clamp(input.fontSize * input.style.lineHeightRatio, 1, 400));
    }
    return undefined;
}

export function buildReferenceTextLineLayoutPlan(input: {
    content: string;
    box: PixelBox;
    canvasHeight: number;
    role?: ReferenceTextPlacementRole;
    style?: MinimalDesignElementStyle;
}): ReferenceTextLineLayoutPlan {
    const originalContent = normalizeTextContent(input.content);
    const role = input.role || 'unknown';
    const baselineFontSize = resolveReferenceTextFontSize({
        style: input.style,
        box: input.box,
        canvasHeight: input.canvasHeight,
        role,
        content: originalContent
    });
    const visualTargetFontSize = resolveReferenceTextFontSize({
        style: input.style,
        box: input.box,
        canvasHeight: input.canvasHeight,
        role
    });
    const explicitFontSize = resolveStyleFontSize(input.style, input.canvasHeight);
    const targetFontSize = explicitFontSize || visualTargetFontSize;
    const existingLines = splitExistingLines(originalContent);
    const explicitLineBreaks = hasExplicitLineBreak(originalContent);
    const maxLineCount = resolveLinePlanCandidateCount({
        content: originalContent,
        box: input.box,
        role
    });

    let best: ReferenceTextLineLayoutPlan | null = null;

    for (let lineCount = 1; lineCount <= maxLineCount; lineCount += 1) {
        const lines = explicitLineBreaks
            ? existingLines
            : splitTextIntoBalancedLines(originalContent, lineCount);
        if (lines.length === 0) {
            continue;
        }
        const maxLineUnits = estimateMaxLineUnits(lines);
        const widthFitFontSize = Math.round(((Number(input.box.width) || 1) / maxLineUnits) * 1.03);
        const heightFitFontSize = Math.round((Number(input.box.height) || 1) / Math.max(1, lines.length * 1.16));
        const maxFitFontSize = Math.min(widthFitFontSize, heightFitFontSize);
        const minFontSize = role === 'title' ? 16 : 10;
        const roleMaxFontSize = role === 'title' ? 160 : 120;
        const fontSize = Math.round(clamp(Math.min(targetFontSize, maxFitFontSize), minFontSize, roleMaxFontSize));
        const leading = lines.length > 1
            ? (resolveReferenceTextLeading({ style: input.style, fontSize }) || Math.round(fontSize * 1.16))
            : resolveReferenceTextLeading({ style: input.style, fontSize });
        const insertedLineBreaks = !explicitLineBreaks && lines.length > 1;
        const candidate: ReferenceTextLineLayoutPlan = {
            originalContent,
            content: lines.join('\n'),
            lines,
            lineCount: lines.length,
            insertedLineBreaks,
            fontSize,
            leading,
            maxLineUnits,
            widthFitFontSize,
            heightFitFontSize
        };

        const explicitScore = explicitFontSize
            ? (maxFitFontSize >= explicitFontSize * 0.9 ? 10000 - lines.length * 20 - Math.abs(maxFitFontSize - explicitFontSize) : maxFitFontSize)
            : fontSize - lines.length * 0.5;
        const bestScore = best
            ? (explicitFontSize
                ? (Math.min(best.widthFitFontSize, best.heightFitFontSize) >= explicitFontSize * 0.9 ? 10000 - best.lineCount * 20 - Math.abs(Math.min(best.widthFitFontSize, best.heightFitFontSize) - explicitFontSize) : Math.min(best.widthFitFontSize, best.heightFitFontSize))
                : best.fontSize - best.lineCount * 0.5)
            : -Infinity;

        if (!best || explicitScore > bestScore) {
            best = candidate;
        }

        if (explicitLineBreaks) {
            break;
        }
    }

    return best || {
        originalContent,
        content: originalContent,
        lines: originalContent ? [originalContent] : [],
        lineCount: originalContent ? 1 : 0,
        insertedLineBreaks: false,
        fontSize: baselineFontSize,
        leading: resolveReferenceTextLeading({ style: input.style, fontSize: baselineFontSize }),
        maxLineUnits: estimateReferenceTextWidthUnits(originalContent),
        widthFitFontSize: resolveReferenceTextWidthFitFontSize({ content: originalContent, boxWidth: input.box.width }) || baselineFontSize,
        heightFitFontSize: baselineFontSize
    };
}

export function buildReferenceTextLayerCreateRequest(input: {
    content: string;
    box: PixelBox;
    fontSize: number;
    colorHex: string;
    tracking?: number;
    leading?: number;
    alignment?: 'left' | 'center' | 'right';
}): ReferenceTextLayerCreateRequest {
    const request: ReferenceTextLayerCreateRequest = {
        content: input.content,
        x: Math.round(input.box.left),
        // Photoshop text creation uses a text origin rather than a pure visual
        // top-left box. This gives a visible initial placement; a bounds-based
        // correction pass aligns the created layer after Photoshop reports bounds.
        y: Math.round(input.box.top + input.fontSize),
        fontSize: input.fontSize,
        colorHex: input.colorHex,
        alignment: input.alignment || 'left'
    };
    if (typeof input.tracking === 'number' && Number.isFinite(input.tracking)) {
        request.tracking = input.tracking;
    }
    if (typeof input.leading === 'number' && Number.isFinite(input.leading) && input.leading > 0) {
        request.leading = input.leading;
    }
    return request;
}

export function resolveTextBoundsCorrection(input: {
    targetBox: PixelBox;
    actualBox?: PixelBox;
    tolerancePx?: number;
}): { dx: number; dy: number; shouldMove: boolean } {
    const tolerancePx = Math.max(0, Number(input.tolerancePx ?? 1) || 0);
    const actual = input.actualBox;
    if (!actual) {
        return { dx: 0, dy: 0, shouldMove: false };
    }

    const dx = Math.round(Number(input.targetBox.left) - Number(actual.left));
    const dy = Math.round(Number(input.targetBox.top) - Number(actual.top));
    return {
        dx,
        dy,
        shouldMove: Math.abs(dx) > tolerancePx || Math.abs(dy) > tolerancePx
    };
}

export function assessTextBoundsFit(input: {
    targetBox: PixelBox;
    actualBox?: PixelBox;
    toleranceRatio?: number;
    tolerancePx?: number;
}): ReferenceTextBoundsFit {
    const actual = input.actualBox;
    if (!actual) {
        return {
            widthDelta: 0,
            heightDelta: 0,
            widthRatio: null,
            heightRatio: null,
            sizeVerified: false,
            issue: 'missing actual text bounds'
        };
    }

    const targetWidth = Math.max(1, Number(input.targetBox.width) || 1);
    const targetHeight = Math.max(1, Number(input.targetBox.height) || 1);
    const actualWidth = Math.max(0, Number(actual.width) || 0);
    const actualHeight = Math.max(0, Number(actual.height) || 0);
    const widthDelta = Math.round(actualWidth - targetWidth);
    const heightDelta = Math.round(actualHeight - targetHeight);
    const widthRatio = actualWidth / targetWidth;
    const heightRatio = actualHeight / targetHeight;
    const toleranceRatio = Math.max(0, Number(input.toleranceRatio ?? 0.35) || 0);
    const tolerancePx = Math.max(0, Number(input.tolerancePx ?? 6) || 0);
    const widthOk = Math.abs(widthDelta) <= Math.max(tolerancePx, targetWidth * toleranceRatio);
    const heightOk = Math.abs(heightDelta) <= Math.max(tolerancePx, targetHeight * toleranceRatio);
    const sizeVerified = widthOk && heightOk;

    return {
        widthDelta,
        heightDelta,
        widthRatio: Number(widthRatio.toFixed(3)),
        heightRatio: Number(heightRatio.toFixed(3)),
        sizeVerified,
        issue: sizeVerified
            ? undefined
            : `text size drift: widthDelta=${widthDelta}, heightDelta=${heightDelta}`
    };
}
