/**
 * 资源管理服务
 * 
 * 功能：
 * 1. 扫描项目目录，识别可用资源（图片、PSD文件等）
 * 2. 生成图片预览/缩略图
 * 3. 提供资源搜索和筛选
 * 4. 支持 AI 自主选择和使用资源
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import sharp from 'sharp';
import { readPsd, initializeCanvas } from 'ag-psd';
import { buildAgentResourceCacheBudget } from '../../shared/agent-performance-policy';
import { extractModelJsonObject } from '../../shared/model-json-extract';
import { measureComposition } from '../../shared/composition-metrics';
import { getSubjectDetectionService } from './subject-detection-service';

// 初始化 ag-psd 的 canvas（使用自定义 createCanvas 函数）
// 由于 Electron 主进程没有 DOM Canvas，使用 Sharp 模拟基础功能
let psdCanvasInitialized = false;

/**
 * 初始化 ag-psd Canvas 支持
 * 使用模拟的 Canvas 实现（仅用于读取缩略图）
 */
function ensurePsdCanvasInitialized(): void {
    if (psdCanvasInitialized) return;
    
    try {
        // 使用简单的占位 Canvas 实现
        // ag-psd 在只读取缩略图时不需要完整的 Canvas 支持
        const createCanvasMock = (width: number, height: number) => {
            const data = new Uint8ClampedArray(width * height * 4);
            return {
                width,
                height,
                getContext: () => ({
                    fillStyle: '',
                    fillRect: () => {},
                    drawImage: () => {},
                    getImageData: () => ({ data, width, height }),
                    putImageData: () => {},
                    createImageData: (w: number, h: number) => ({ 
                        data: new Uint8ClampedArray(w * h * 4),
                        width: w,
                        height: h
                    }),
                }),
                toBuffer: () => Buffer.alloc(0),
            } as any;
        };
        
        // createImageData 函数（可选）
        const createImageDataMock = (width: number, height: number) => {
            return {
                data: new Uint8ClampedArray(width * height * 4),
                width,
                height
            } as any;
        };
        
        initializeCanvas(createCanvasMock, createImageDataMock);
        psdCanvasInitialized = true;
        console.log('[ResourceManager] ag-psd Canvas 已初始化（轻量模式）');
    } catch (e) {
        console.warn('[ResourceManager] ag-psd Canvas 初始化失败:', e);
    }
}

// 支持的图片格式
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.tif'];
const DESIGN_EXTENSIONS = ['.psd', '.psb', '.ai', '.eps', '.svg'];
const ALL_SUPPORTED = [...IMAGE_EXTENSIONS, ...DESIGN_EXTENSIONS];
const RESOURCE_CACHE_BUDGET = buildAgentResourceCacheBudget();

type PixelProbeStatus = 'ok' | 'watch' | 'unverified';

type ImageVisualMetricsProbe = {
    sampleSize: { width: number; height: number };
    nonWhitePixelRatio: number;
    nonWhiteBounds?: {
        x: number;
        y: number;
        width: number;
        height: number;
        centerX: number;
        centerY: number;
        widthRatio: number;
        heightRatio: number;
    };
    edgeOccupancy: {
        top: number;
        right: number;
        bottom: number;
        left: number;
    };
    averageLuma?: number;
    lumaStdDev?: number;
    darkPixelRatio: number;
    highlightPixelRatio: number;
    shadowLikePixelRatio: number;
    textureContrastScore?: number;
    backgroundColor?: {
        r: number;
        g: number;
        b: number;
        luma: number;
    };
    backgroundDistanceThreshold?: number;
    rawImagesRedacted: true;
};

export interface AnalyzeDesignReferenceRequest {
    imagePath: string;
    referenceTitle?: string;
    referenceTags?: string[];
    referenceSource?: string;
    topics?: string[];
    cadence?: string;
}

export interface DesignReferenceAnalysisResult {
    success: boolean;
    observation?: {
        analysisSource: string;
        productCategory?: string;
        designType?: string;
        summary: string;
        strengths: Array<{
            aspect: string;
            observation: string;
            reason: string;
            suitableFor?: string[];
        }>;
        suitableScenarios: string[];
        avoidWhen: string[];
        reusableHeuristics: string[];
        reviewStatus: 'needs_human_review';
        sourceNotes: string[];
        limitations: string[];
    };
    error?: string;
    rawModelTextRedacted?: true;
}

function toPositiveInt(value: unknown, fallback: number): number {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
    return Math.max(1, Math.round(numeric));
}

function roundMetric(value: number, digits: number): number | undefined {
    if (!Number.isFinite(value)) return undefined;
    const factor = Math.pow(10, digits);
    return Math.round(value * factor) / factor;
}

function getPixelOffset(width: number, channels: number, x: number, y: number): number {
    return (y * width + x) * channels;
}

function getLuma(r: number, g: number, b: number): number {
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function quantizeChannel(value: number): number {
    return Math.max(0, Math.min(255, Math.round(value / 8) * 8));
}

function estimateCanvasBackgroundColor(
    data: Buffer,
    width: number,
    height: number,
    channels: number
): { r: number; g: number; b: number; luma: number; distanceThreshold: number } {
    const edgeBandX = Math.max(1, Math.round(width * 0.04));
    const edgeBandY = Math.max(1, Math.round(height * 0.04));
    const buckets = new Map<string, { count: number; r: number; g: number; b: number }>();
    const addSample = (x: number, y: number): void => {
        const offset = getPixelOffset(width, channels, x, y);
        const alpha = data[offset + 3];
        if (alpha <= 8) return;
        const r = data[offset];
        const g = data[offset + 1];
        const b = data[offset + 2];
        const key = `${quantizeChannel(r)},${quantizeChannel(g)},${quantizeChannel(b)}`;
        const bucket = buckets.get(key) || { count: 0, r: 0, g: 0, b: 0 };
        bucket.count += 1;
        bucket.r += r;
        bucket.g += g;
        bucket.b += b;
        buckets.set(key, bucket);
    };

    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            if (x < edgeBandX || x >= width - edgeBandX || y < edgeBandY || y >= height - edgeBandY) {
                addSample(x, y);
            }
        }
    }

    let best: { count: number; r: number; g: number; b: number } | undefined;
    for (const bucket of buckets.values()) {
        if (!best || bucket.count > best.count) best = bucket;
    }
    if (!best || best.count <= 0) {
        return { r: 255, g: 255, b: 255, luma: 255, distanceThreshold: 6 };
    }

    const r = best.r / best.count;
    const g = best.g / best.count;
    const b = best.b / best.count;
    const luma = getLuma(r, g, b);
    const distanceThreshold = luma >= 248
        ? 6
        : luma >= 224
            ? 10
            : 14;
    return { r, g, b, luma, distanceThreshold };
}

function isForegroundPixelAgainstBackground(
    r: number,
    g: number,
    b: number,
    alpha: number,
    background: { r: number; g: number; b: number; distanceThreshold: number }
): boolean {
    if (alpha <= 8) return false;
    if (alpha < 250) return true;
    const maxChannelDelta = Math.max(
        Math.abs(r - background.r),
        Math.abs(g - background.g),
        Math.abs(b - background.b)
    );
    return maxChannelDelta > background.distanceThreshold;
}

async function buildImageVisualMetricsProbe(imagePath: string): Promise<ImageVisualMetricsProbe | undefined> {
    const sampleLimit = 256;
    const { data, info } = await sharp(imagePath, { failOnError: false })
        .rotate()
        .resize({ width: sampleLimit, height: sampleLimit, fit: 'inside', withoutEnlargement: true })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
    const width = info.width || 0;
    const height = info.height || 0;
    const channels = info.channels || 4;
    if (!width || !height || channels < 4 || data.length === 0) return undefined;

    let nonWhitePixels = 0;
    let darkPixels = 0;
    let highlightPixels = 0;
    let shadowLikePixels = 0;
    let lumaSum = 0;
    let lumaSquaredSum = 0;
    let textureDeltaSum = 0;
    let textureDeltaCount = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    const edgeBandX = Math.max(1, Math.round(width * 0.04));
    const edgeBandY = Math.max(1, Math.round(height * 0.04));
    let topEdge = 0;
    let rightEdge = 0;
    let bottomEdge = 0;
    let leftEdge = 0;
    const background = estimateCanvasBackgroundColor(data, width, height, channels);

    const isForegroundAt = (x: number, y: number): { isForeground: boolean; luma: number } => {
        const offset = getPixelOffset(width, channels, x, y);
        const alpha = data[offset + 3];
        if (alpha <= 8) return { isForeground: false, luma: 255 };
        const r = data[offset];
        const g = data[offset + 1];
        const b = data[offset + 2];
        const luma = getLuma(r, g, b);
        const isForeground = isForegroundPixelAgainstBackground(r, g, b, alpha, background);
        return { isForeground, luma };
    };

    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const offset = (y * width + x) * channels;
            const r = data[offset];
            const g = data[offset + 1];
            const b = data[offset + 2];
            const max = Math.max(r, g, b);
            const min = Math.min(r, g, b);
            const saturationSpread = max - min;
            const { isForeground, luma } = isForegroundAt(x, y);
            if (!isForeground) continue;

            nonWhitePixels += 1;
            lumaSum += luma;
            lumaSquaredSum += luma * luma;
            if (luma < 48) darkPixels += 1;
            if (luma > 245) highlightPixels += 1;
            if (saturationSpread <= 18 && luma >= 35 && luma <= 235) shadowLikePixels += 1;
            if (x < edgeBandX) leftEdge += 1;
            if (x >= width - edgeBandX) rightEdge += 1;
            if (y < edgeBandY) topEdge += 1;
            if (y >= height - edgeBandY) bottomEdge += 1;

            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);

            if (x + 1 < width) {
                const neighbor = isForegroundAt(x + 1, y);
                if (neighbor.isForeground) {
                    textureDeltaSum += Math.abs(luma - neighbor.luma);
                    textureDeltaCount += 1;
                }
            }
            if (y + 1 < height) {
                const neighbor = isForegroundAt(x, y + 1);
                if (neighbor.isForeground) {
                    textureDeltaSum += Math.abs(luma - neighbor.luma);
                    textureDeltaCount += 1;
                }
            }
        }
    }

    const totalPixels = width * height;
    const mean = nonWhitePixels > 0 ? lumaSum / nonWhitePixels : undefined;
    const variance = mean !== undefined && nonWhitePixels > 0
        ? Math.max(0, (lumaSquaredSum / nonWhitePixels) - (mean * mean))
        : undefined;
    const boundsWidth = maxX >= minX ? maxX - minX + 1 : 0;
    const boundsHeight = maxY >= minY ? maxY - minY + 1 : 0;

    return {
        sampleSize: { width, height },
        nonWhitePixelRatio: roundMetric(nonWhitePixels / totalPixels, 4) || 0,
        nonWhiteBounds: boundsWidth > 0 && boundsHeight > 0 ? {
            x: roundMetric(minX / width, 4) || 0,
            y: roundMetric(minY / height, 4) || 0,
            width: boundsWidth,
            height: boundsHeight,
            centerX: roundMetric((minX + boundsWidth / 2) / width, 4) || 0,
            centerY: roundMetric((minY + boundsHeight / 2) / height, 4) || 0,
            widthRatio: roundMetric(boundsWidth / width, 4) || 0,
            heightRatio: roundMetric(boundsHeight / height, 4) || 0
        } : undefined,
        edgeOccupancy: {
            top: roundMetric(topEdge / Math.max(1, width * edgeBandY), 4) || 0,
            right: roundMetric(rightEdge / Math.max(1, edgeBandX * height), 4) || 0,
            bottom: roundMetric(bottomEdge / Math.max(1, width * edgeBandY), 4) || 0,
            left: roundMetric(leftEdge / Math.max(1, edgeBandX * height), 4) || 0
        },
        averageLuma: mean !== undefined ? roundMetric(mean, 2) : undefined,
        lumaStdDev: variance !== undefined ? roundMetric(Math.sqrt(variance), 2) : undefined,
        darkPixelRatio: roundMetric(darkPixels / Math.max(1, nonWhitePixels), 4) || 0,
        highlightPixelRatio: roundMetric(highlightPixels / Math.max(1, nonWhitePixels), 4) || 0,
        shadowLikePixelRatio: roundMetric(shadowLikePixels / Math.max(1, nonWhitePixels), 4) || 0,
        textureContrastScore: textureDeltaCount > 0 ? roundMetric(textureDeltaSum / textureDeltaCount, 2) : undefined,
        backgroundColor: {
            r: Math.round(background.r),
            g: Math.round(background.g),
            b: Math.round(background.b),
            luma: roundMetric(background.luma, 2) || 0
        },
        backgroundDistanceThreshold: background.distanceThreshold,
        rawImagesRedacted: true
    };
}

async function readLumaRawForProbe(input: string | Buffer, width: number, height: number, blurSigma = 0): Promise<Buffer> {
    let image = sharp(input, { failOnError: false })
        .resize(width, height, { fit: 'fill' })
        .removeAlpha()
        .grayscale();
    if (Number.isFinite(blurSigma) && blurSigma > 0) {
        image = image.blur(blurSigma);
    }
    return image.raw().toBuffer();
}

function compareLumaRawForProbe(referenceRaw: Buffer, resultRaw: Buffer, darkThreshold = 180): {
    pixelCount: number;
    mae: number;
    rmse: number;
    highDeltaRatio: number;
    referenceDark: number;
    resultDark: number;
    darkJaccard: number;
} {
    let absoluteError = 0;
    let squaredError = 0;
    let highDeltaPixels = 0;
    let referenceDark = 0;
    let resultDark = 0;
    let darkIntersection = 0;
    let darkUnion = 0;

    const pixelCount = Math.min(referenceRaw.length, resultRaw.length);
    for (let pixel = 0; pixel < pixelCount; pixel += 1) {
        const refLuma = referenceRaw[pixel];
        const resultLuma = resultRaw[pixel];
        const delta = Math.abs(refLuma - resultLuma);
        absoluteError += delta;
        squaredError += delta * delta;
        if (delta > 32) highDeltaPixels += 1;
        const refIsDark = refLuma < darkThreshold;
        const resultIsDark = resultLuma < darkThreshold;
        if (refIsDark) referenceDark += 1;
        if (resultIsDark) resultDark += 1;
        if (refIsDark && resultIsDark) darkIntersection += 1;
        if (refIsDark || resultIsDark) darkUnion += 1;
    }

    return {
        pixelCount,
        mae: pixelCount > 0 ? absoluteError / pixelCount : Number.POSITIVE_INFINITY,
        rmse: pixelCount > 0 ? Math.sqrt(squaredError / pixelCount) : Number.POSITIVE_INFINITY,
        highDeltaRatio: pixelCount > 0 ? highDeltaPixels / pixelCount : 1,
        referenceDark,
        resultDark,
        darkJaccard: darkUnion > 0 ? darkIntersection / darkUnion : 1
    };
}

/**
 * 资源文件信息
 */
export interface ResourceFile {
    /** 文件名 */
    name: string;
    /** 完整路径 */
    path: string;
    /** 相对路径 */
    relativePath: string;
    /** 文件类型 */
    type: 'image' | 'design' | 'folder';
    /** 文件扩展名 */
    extension: string;
    /** 文件大小（字节） */
    size: number;
    /** 修改时间 */
    modifiedTime: Date;
    /** 图片尺寸（仅图片） */
    dimensions?: { width: number; height: number };
    /** 缩略图 base64（可选） */
    thumbnail?: string;
}

/**
 * 目录扫描结果
 */
export interface DirectoryScanResult {
    /** 根目录路径 */
    rootPath: string;
    /** 总文件数 */
    totalFiles: number;
    /** 图片数量 */
    imageCount: number;
    /** 设计文件数量 */
    designCount: number;
    /** 文件列表 */
    files: ResourceFile[];
    /** 子目录列表 */
    subDirectories: string[];
    /** 错误信息 */
    errors?: string[];
}

export interface ProjectContactSheetImageInput {
    path: string;
    relativePath?: string;
    labelHint?: string;
    role?: string;
}

export interface ProjectContactSheetOverviewOptions {
    projectPath?: string;
    images?: ProjectContactSheetImageInput[];
    columns?: number;
    tileWidth?: number;
    tileHeight?: number;
    maxImages?: number;
}

export interface ProjectContactSheetOverviewAnalysisOptions extends ProjectContactSheetOverviewOptions {
    focus?: string;
    userIntent?: string;
}

export interface ProjectContactSheetOverviewItem {
    id: string;
    path: string;
    relativePath?: string;
    labelHint?: string;
    role?: string;
    status: 'rendered' | 'failed';
    error?: string;
    box: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
}

export interface ProjectContactSheetOverviewResult {
    success: boolean;
    sheet?: {
        imageData: string;
        mediaType: 'image/jpeg';
        width: number;
        height: number;
        columns: number;
        rows: number;
        tileWidth: number;
        tileHeight: number;
    };
    items: ProjectContactSheetOverviewItem[];
    warnings: string[];
    limitations: string[];
    error?: string;
}

export interface ProjectContactSheetOverviewObservation {
    projectStyle?: string;
    productUnderstanding?: string;
    sellingPoints: string[];
    imageRoles: Array<{
        id: string;
        role: string;
        reason?: string;
    }>;
    nextSingleImageChecks: string[];
    rawText?: string;
}

export interface ProjectContactSheetOverviewAnalysisResult {
    success: boolean;
    contactSheet: ProjectContactSheetOverviewResult;
    observation?: ProjectContactSheetOverviewObservation;
    rawText?: string;
    warnings: string[];
    limitations: string[];
    error?: string;
}

/**
 * 素材视觉分析结果（analyzeAssetContent 的 analysis 字段）
 */
type AssetContentAnalysis = {
    description: string;
    /** 素材本质：raw_photo 原始拍摄素材（可用原料）/ finished_design 已完成设计成品（交付物，不当素材） */
    assetNature?: string;
    visibleText?: string;
    category: string;
    mainSubject: string;
    /** 主体（被售卖商品本身）占画面面积档位：dominant/moderate/small。仅视觉判断，供选图择优。 */
    subjectCoverageRatio?: string;
    /** 主体在画面中的主要位置：center/top/bottom/left/right/scattered。 */
    subjectPosition?: string;
    /** 画面视觉重心实际落在什么上（如『袜子/腿部』或『裙子/上半身』），用于识别"商品不突出"。 */
    compositionFocus?: string;
    /** 是否适合做需要突出该商品的主图：suitable/marginal/unsuitable。 */
    mainImageSuitability?: string;
    /** mainImageSuitability 的简短理由。 */
    mainImageSuitabilityReason?: string;
    /** 拍摄形态：flat_lay 平铺 / on_model 模特上身 / detail_closeup 细节特写 / package 包装 / chart 色卡图表 / scene 场景 / other。设计师按此给素材归类。 */
    shotType?: string;
    /** 卖点观察：记录图中真实可见内容及其可支持的卖点，不做超出画面的推断，无则空数组。 */
    sellingPointObservations?: string[];
    colors: string[];
    style: string;
    suggestedPlacement: string;
    suggestedEffects: string[];
};

/**
 * analyzeAssetContent 的返回结构
 */
type AssetContentAnalysisResult = {
    success: boolean;
    analysis?: AssetContentAnalysis;
    error?: string;
    /** 命中 main 端结果缓存时为 true（同一文件内容在进程生命周期内只分析一次） */
    fromCache?: boolean;
};

function clampContactSheetNumber(value: unknown, fallback: number, min: number, max: number): number {
    const numeric = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(min, Math.min(max, Math.round(numeric)));
}

function escapeContactSheetXml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function truncateContactSheetLabel(value: string | undefined, maxLength: number): string {
    const normalized = (value || '').replace(/\s+/g, ' ').trim();
    if (normalized.length <= maxLength) return normalized;
    return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}

function cleanContactSheetText(value: unknown): string {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeContactSheetTextList(values: unknown): string[] {
    if (!Array.isArray(values)) return [];
    return Array.from(new Set(values.map(cleanContactSheetText).filter(Boolean)));
}

function buildContactSheetLabelSvg(options: {
    id: string;
    width: number;
    height: number;
    relativePath?: string;
    labelHint?: string;
    role?: string;
    failed?: boolean;
}): Buffer {
    const title = truncateContactSheetLabel(options.labelHint || options.role || options.relativePath || '', 18);
    const subtitle = truncateContactSheetLabel(options.relativePath || '', 28);
    const statusText = options.failed ? '无法预览' : '';
    const titleText = escapeContactSheetXml(title || statusText || '未命名素材');
    const subtitleText = escapeContactSheetXml(subtitle);
    const idText = escapeContactSheetXml(options.id);
    const statusLine = statusText
        ? `<text x="14" y="${options.height - 16}" font-size="13" fill="#b42318" font-family="Arial, sans-serif">${escapeContactSheetXml(statusText)}</text>`
        : '';

    return Buffer.from(`
        <svg width="${options.width}" height="${options.height}" xmlns="http://www.w3.org/2000/svg">
            <rect x="0.5" y="0.5" width="${options.width - 1}" height="${options.height - 1}" rx="8" fill="#ffffff" stroke="#d9dde5"/>
            <rect x="10" y="10" width="44" height="26" rx="13" fill="#111827"/>
            <text x="32" y="28" font-size="14" fill="#ffffff" font-weight="700" text-anchor="middle" font-family="Arial, sans-serif">${idText}</text>
            <text x="14" y="${options.height - 38}" font-size="14" fill="#111827" font-weight="700" font-family="Arial, sans-serif">${titleText}</text>
            <text x="14" y="${options.height - 18}" font-size="11" fill="#6b7280" font-family="Arial, sans-serif">${subtitleText}</text>
            ${statusLine}
        </svg>
    `, 'utf8');
}

function buildContactSheetVisionPrompt(input: {
    options: ProjectContactSheetOverviewAnalysisOptions;
    contactSheet: ProjectContactSheetOverviewResult;
}): string {
    const { options, contactSheet } = input;
    const manifest = contactSheet.items
        .map((item) => {
            const parts = [
                `${item.id}: ${item.relativePath || item.path}`,
                item.labelHint ? `label=${item.labelHint}` : '',
                item.role ? `roleHint=${item.role}` : '',
                `status=${item.status}`
            ].filter(Boolean);
            return `- ${parts.join(' | ')}`;
        })
        .join('\n');

    return `你正在查看一张项目图片缩略图总览。每张图都有编号，编号和文件清单如下：
${manifest}

用户意图：${options.userIntent || '理解项目图片，提炼后续设计方向。'}
分析焦点：${options.focus || 'style-and-selling-points'}

请只基于你在这张总览图中能看到的内容做判断，不要编造图片里看不到的信息。
输出 JSON，字段：
{
  "projectStyle": "整体拍摄/视觉风格",
  "productUnderstanding": "这是什么产品或款式，有哪些可见特征",
  "sellingPoints": ["从画面可支持的卖点或用户关注点"],
  "imageRoles": [{"id":"A01","role":"SKU/主图/详情页/细节/场景/待确认","reason":"依据"}],
  "nextSingleImageChecks": ["后续需要单图放大复核的编号"]
}`;
}

function normalizeContactSheetObservation(rawText: string): ProjectContactSheetOverviewObservation {
    const parsed = extractModelJsonObject(rawText)?.value as any;
    if (!parsed || typeof parsed !== 'object') {
        return {
            sellingPoints: [],
            imageRoles: [],
            nextSingleImageChecks: [],
            rawText
        };
    }

    const roleItems = Array.isArray(parsed.imageRoles) ? parsed.imageRoles : [];
    return {
        projectStyle: cleanContactSheetText(parsed.projectStyle) || undefined,
        productUnderstanding: cleanContactSheetText(parsed.productUnderstanding) || undefined,
        sellingPoints: normalizeContactSheetTextList(parsed.sellingPoints),
        imageRoles: roleItems
            .map((item: any) => ({
                id: cleanContactSheetText(item?.id),
                role: cleanContactSheetText(item?.role),
                reason: cleanContactSheetText(item?.reason) || undefined
            }))
            .filter((item: { id: string; role: string }) => item.id && item.role),
        nextSingleImageChecks: normalizeContactSheetTextList(parsed.nextSingleImageChecks),
        rawText
    };
}

/**
 * 资源管理服务
 */
export class ResourceManagerService {
    private projectRoot: string = '';
    private cachedResources: Map<string, ResourceFile[]> = new Map();
    private cacheExpiry: number = RESOURCE_CACHE_BUDGET.resourceScanCacheTtlMs;
    private lastCacheTime: Map<string, number> = new Map();

    // PSD/PSB 预览缓存（避免重复解析大文件）
    private psdPreviewCache: Map<string, { result: any; timestamp: number }> = new Map();
    private psdCacheExpiry: number = RESOURCE_CACHE_BUDGET.psdPreviewCacheTtlMs;

    // 素材视觉分析结果缓存：键 = imagePath + mtimeMs + size（文件内容变化后自动失效）。
    // 单图视觉分析耗时 30 秒以上，进程生命周期内同一文件内容只分析一次；
    // 只缓存成功结果，失败不缓存（不做负缓存，避免掩盖暂时性故障）。
    private assetAnalysisCache: Map<string, AssetContentAnalysis> = new Map();
    private static readonly ASSET_ANALYSIS_CACHE_MAX_ENTRIES = 200;

    // in-flight 合并：同 key 的并发分析请求共享同一个 Promise，避免重复调用视觉模型
    private assetAnalysisInFlight: Map<string, Promise<AssetContentAnalysisResult>> = new Map();

    // 视觉模型调用并发闸门：本地模型（如 ollama）并发推理会争抢显存，限制同时进行的调用数
    private static readonly VISION_CALL_MAX_CONCURRENCY = 2;
    private visionCallActive = 0;
    private visionCallWaiters: Array<() => void> = [];

    constructor() {
        console.log('[ResourceManager] 服务初始化');
        // 初始化 Canvas 环境
        ensurePsdCanvasInitialized();
    }

    private calcChecksum(buffer: Buffer): string {
        // FNV-1a 32-bit, deterministic across Agent/UXP runtimes.
        let hash = 0x811c9dc5;
        for (let i = 0; i < buffer.length; i++) {
            hash ^= buffer[i];
            hash = Math.imul(hash, 0x01000193);
        }
        const hex = (hash >>> 0).toString(16).padStart(8, '0');
        return `fnv1a32:${hex}`;
    }

    /**
     * 设置项目根目录
     */
    setProjectRoot(rootPath: string): void {
        this.projectRoot = rootPath;
        this.clearCache();
        console.log('[ResourceManager] 项目根目录:', rootPath);
    }

    /**
     * 获取项目根目录
     */
    getProjectRoot(): string {
        return this.projectRoot;
    }

    /**
     * 清除缓存
     */
    clearCache(): void {
        this.cachedResources.clear();
        this.lastCacheTime.clear();
    }

    /**
     * 扫描目录
     */
    async scanDirectory(
        dirPath?: string,
        options: {
            recursive?: boolean;
            includeDesignFiles?: boolean;
            maxDepth?: number;
            generateThumbnails?: boolean;
        } = {}
    ): Promise<DirectoryScanResult> {
        const {
            recursive = true,
            includeDesignFiles = true,
            maxDepth = 5,
            generateThumbnails = false
        } = options;

        const targetPath = dirPath || this.projectRoot;
        
        if (!targetPath || !fs.existsSync(targetPath)) {
            return {
                rootPath: targetPath || '',
                totalFiles: 0,
                imageCount: 0,
                designCount: 0,
                files: [],
                subDirectories: [],
                errors: ['目录不存在或未设置项目根目录']
            };
        }

        // 检查缓存
        const cacheKey = `${targetPath}:${recursive}:${includeDesignFiles}`;
        const cachedTime = this.lastCacheTime.get(cacheKey);
        if (cachedTime && Date.now() - cachedTime < this.cacheExpiry) {
            const cached = this.cachedResources.get(cacheKey);
            if (cached) {
                return {
                    rootPath: targetPath,
                    totalFiles: cached.length,
                    imageCount: cached.filter(f => f.type === 'image').length,
                    designCount: cached.filter(f => f.type === 'design').length,
                    files: cached,
                    subDirectories: this.getSubDirectories(targetPath)
                };
            }
        }

        const files: ResourceFile[] = [];
        const errors: string[] = [];
        const subDirectories: string[] = [];

        const scanDir = async (currentPath: string, depth: number = 0) => {
            if (depth > maxDepth) return;

            try {
                const entries = fs.readdirSync(currentPath, { withFileTypes: true });

                for (const entry of entries) {
                    const fullPath = path.join(currentPath, entry.name);
                    
                    // 跳过隐藏文件和 node_modules
                    if (entry.name.startsWith('.') || entry.name === 'node_modules') {
                        continue;
                    }

                    if (entry.isDirectory()) {
                        if (depth === 0) {
                            subDirectories.push(entry.name);
                        }
                        if (recursive) {
                            await scanDir(fullPath, depth + 1);
                        }
                    } else if (entry.isFile()) {
                        const ext = path.extname(entry.name).toLowerCase();
                        const isImage = IMAGE_EXTENSIONS.includes(ext);
                        const isDesign = DESIGN_EXTENSIONS.includes(ext);

                        if (isImage || (includeDesignFiles && isDesign)) {
                            try {
                                const stats = fs.statSync(fullPath);
                                const resourceFile: ResourceFile = {
                                    name: entry.name,
                                    path: fullPath,
                                    relativePath: path.relative(targetPath, fullPath),
                                    type: isImage ? 'image' : 'design',
                                    extension: ext,
                                    size: stats.size,
                                    modifiedTime: stats.mtime
                                };

                                // 获取图片尺寸
                                if (isImage) {
                                    try {
                                        const metadata = await sharp(fullPath).metadata();
                                        resourceFile.dimensions = {
                                            width: metadata.width || 0,
                                            height: metadata.height || 0
                                        };

                                        // 生成缩略图
                                        if (generateThumbnails) {
                                            const thumbnail = await this.generateThumbnail(fullPath);
                                            if (thumbnail) {
                                                resourceFile.thumbnail = thumbnail;
                                            }
                                        }
                                    } catch (e) {
                                        // 无法读取图片元数据，跳过
                                    }
                                }

                                files.push(resourceFile);
                            } catch (e) {
                                errors.push(`无法读取文件 ${fullPath}: ${e}`);
                            }
                        }
                    }
                }
            } catch (e) {
                errors.push(`无法扫描目录 ${currentPath}: ${e}`);
            }
        };

        await scanDir(targetPath);

        // 更新缓存
        this.cachedResources.set(cacheKey, files);
        this.lastCacheTime.set(cacheKey, Date.now());

        return {
            rootPath: targetPath,
            totalFiles: files.length,
            imageCount: files.filter(f => f.type === 'image').length,
            designCount: files.filter(f => f.type === 'design').length,
            files,
            subDirectories,
            errors: errors.length > 0 ? errors : undefined
        };
    }

    /**
     * 获取子目录列表
     */
    private getSubDirectories(dirPath: string): string[] {
        try {
            const entries = fs.readdirSync(dirPath, { withFileTypes: true });
            return entries
                .filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
                .map(e => e.name);
        } catch {
            return [];
        }
    }

    /**
     * 生成缩略图
     */
    async generateThumbnail(imagePath: string, size: number = 150): Promise<string | null> {
        try {
            // 验证文件存在
            if (!fs.existsSync(imagePath)) {
                return null;
            }
            
            const ext = path.extname(imagePath).toLowerCase();
            
            // PSD/PSB 使用专门的方法
            if (ext === '.psd' || ext === '.psb') {
                const psdResult = await this.getPsdPreview(imagePath, size);
                // 确保返回的是 base64 字符串
                if (psdResult.success && psdResult.imageData) {
                    return psdResult.imageData;
                } else if (psdResult.success && psdResult.base64) {
                    return psdResult.base64;
                }
                return null;
            }
            
            // 不支持的格式直接返回 null
            const unsupportedFormats = ['.ai', '.eps', '.raw', '.cr2', '.nef', '.arw', '.dng'];
            if (unsupportedFormats.includes(ext)) {
                return null;
            }
            
            const buffer = await sharp(imagePath, { failOnError: false })
                .resize(size, size, { fit: 'inside' })
                .jpeg({ quality: 70 })
                .toBuffer();
            
            return buffer.toString('base64');
        } catch (e: any) {
            // 只记录非预期错误，跳过常见的格式不支持错误
            if (!e.message?.includes('unsupported image format') && 
                !e.message?.includes('Input file is missing')) {
                console.warn('[ResourceManager] 生成缩略图失败:', path.basename(imagePath), e.message);
            }
            return null;
        }
    }

    /**
     * 生成项目素材缩略图总览。
     *
     * 这是给 Agent 使用的观察输入：一张带稳定编号的总览图 + 编号清单。
     * 它不判断素材用途，也不替 SKU/主图/详情页做业务决策。
     */
    async createProjectContactSheetOverview(
        options: ProjectContactSheetOverviewOptions = {}
    ): Promise<ProjectContactSheetOverviewResult> {
        const warnings: string[] = [];
        const rootPath = options.projectPath || this.projectRoot || '';
        const maxImages = clampContactSheetNumber(options.maxImages, 40, 1, 80);
        const columns = clampContactSheetNumber(options.columns, 4, 1, 8);
        const tileWidth = clampContactSheetNumber(options.tileWidth, 220, 160, 420);
        const tileHeight = clampContactSheetNumber(options.tileHeight, 260, 180, 460);
        const requestedImages = (options.images || [])
            .filter((image) => image && typeof image.path === 'string' && image.path.trim())
            .slice(0, maxImages);

        if (requestedImages.length === 0) {
            return {
                success: false,
                items: [],
                warnings: ['没有可用于生成项目总览的图片。'],
                limitations: ['总览图只处理调用方传入的图片列表，不会自行扫描项目目录。'],
                error: '没有可预览图片'
            };
        }

        if ((options.images || []).length > requestedImages.length) {
            warnings.push(`已限制总览图片数量：${requestedImages.length}/${(options.images || []).length}`);
        }

        const rows = Math.ceil(requestedImages.length / columns);
        const width = columns * tileWidth;
        const height = rows * tileHeight;
        const labelHeight = Math.min(64, Math.max(52, Math.round(tileHeight * 0.22)));
        const tilePadding = 12;
        const thumbTop = 46;
        const thumbWidth = tileWidth - tilePadding * 2;
        const thumbHeight = Math.max(32, tileHeight - thumbTop - labelHeight - tilePadding);
        const composites: sharp.OverlayOptions[] = [];
        const items: ProjectContactSheetOverviewItem[] = [];

        for (let index = 0; index < requestedImages.length; index += 1) {
            const input = requestedImages[index];
            const fullPath = path.isAbsolute(input.path)
                ? input.path
                : path.resolve(rootPath || process.cwd(), input.path);
            const relativePath = input.relativePath
                || (rootPath ? path.relative(rootPath, fullPath) : path.basename(fullPath));
            const id = `A${String(index + 1).padStart(2, '0')}`;
            const column = index % columns;
            const row = Math.floor(index / columns);
            const x = column * tileWidth;
            const y = row * tileHeight;
            const item: ProjectContactSheetOverviewItem = {
                id,
                path: fullPath,
                relativePath,
                labelHint: input.labelHint,
                role: input.role,
                status: 'rendered',
                box: { x, y, width: tileWidth, height: tileHeight }
            };

            composites.push({
                input: buildContactSheetLabelSvg({
                    id,
                    width: tileWidth,
                    height: tileHeight,
                    relativePath,
                    labelHint: input.labelHint,
                    role: input.role
                }),
                left: x,
                top: y
            });

            try {
                if (!fs.existsSync(fullPath)) {
                    throw new Error('文件不存在');
                }

                const ext = path.extname(fullPath).toLowerCase();
                if (!IMAGE_EXTENSIONS.includes(ext)) {
                    throw new Error('不支持的图片格式');
                }

                const thumb = await sharp(fullPath, { failOnError: false })
                    .rotate()
                    .resize(thumbWidth, thumbHeight, {
                        fit: 'contain',
                        background: '#ffffff',
                        withoutEnlargement: false
                    })
                    .flatten({ background: '#ffffff' })
                    .jpeg({ quality: 82 })
                    .toBuffer();

                const metadata = await sharp(thumb).metadata();
                const thumbX = x + tilePadding + Math.max(0, Math.round((thumbWidth - (metadata.width || thumbWidth)) / 2));
                const thumbY = y + thumbTop + Math.max(0, Math.round((thumbHeight - (metadata.height || thumbHeight)) / 2));

                composites.push({
                    input: thumb,
                    left: thumbX,
                    top: thumbY
                });
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                item.status = 'failed';
                item.error = message;
                warnings.push(`${id} 无法预览：${message}`);
                composites.push({
                    input: buildContactSheetLabelSvg({
                        id,
                        width: tileWidth,
                        height: tileHeight,
                        relativePath,
                        labelHint: input.labelHint,
                        role: input.role,
                        failed: true
                    }),
                    left: x,
                    top: y
                });
            }

            items.push(item);
        }

        try {
            const buffer = await sharp({
                create: {
                    width,
                    height,
                    channels: 3,
                    background: '#f3f4f6'
                }
            })
                .composite(composites)
                .jpeg({ quality: 88 })
                .toBuffer();

            const renderedCount = items.filter((item) => item.status === 'rendered').length;
            return {
                success: renderedCount > 0,
                sheet: {
                    imageData: buffer.toString('base64'),
                    mediaType: 'image/jpeg',
                    width,
                    height,
                    columns,
                    rows,
                    tileWidth,
                    tileHeight
                },
                items,
                warnings,
                limitations: [
                    '总览图用于项目级快速观察；细节、材质和文字仍需要按编号进入单图复核。',
                    '总览图不替 Agent 判断图片用途，只提供带编号的视觉观察。'
                ],
                error: renderedCount > 0 ? undefined : '所有图片都无法预览'
            };
        } catch (error) {
            return {
                success: false,
                items,
                warnings,
                limitations: [
                    '总览图用于项目级快速观察；细节、材质和文字仍需要按编号进入单图复核。'
                ],
                error: `生成项目总览失败: ${error instanceof Error ? error.message : error}`
            };
        }
    }

    /**
     * 用视觉模型理解项目缩略图总览。
     *
     * 这一步提供“项目第一眼观察”，帮助 Agent 决定后续要放大复核哪些单图；
     * 它不替代单图分析，也不直接生成设计结论。
     */
    async analyzeProjectContactSheetOverview(
        options: ProjectContactSheetOverviewAnalysisOptions,
        visionModelCall: (imageBase64: string, prompt: string) => Promise<string>
    ): Promise<ProjectContactSheetOverviewAnalysisResult> {
        const contactSheet = await this.createProjectContactSheetOverview(options);
        const warnings = [...contactSheet.warnings];
        const limitations = [
            ...contactSheet.limitations,
            '总览视觉理解只适合判断整体风格、图片角色和候选方向；关键卖点仍需单图放大复核。'
        ];

        if (!contactSheet.success || !contactSheet.sheet?.imageData) {
            return {
                success: false,
                contactSheet,
                warnings,
                limitations,
                error: contactSheet.error || '项目总览图生成失败，无法进入视觉理解。'
            };
        }

        try {
            const prompt = buildContactSheetVisionPrompt({ options, contactSheet });
            const rawText = await this.runWithVisionCallGate(() => visionModelCall(
                `data:image/jpeg;base64,${contactSheet.sheet!.imageData}`,
                prompt
            ));
            const observation = normalizeContactSheetObservation(rawText);

            return {
                success: true,
                contactSheet,
                observation,
                rawText,
                warnings,
                limitations
            };
        } catch (error) {
            return {
                success: false,
                contactSheet,
                warnings,
                limitations,
                error: `项目总览视觉理解失败: ${error instanceof Error ? error.message : error}`
            };
        }
    }

    /**
     * 获取图片预览（较大尺寸，支持 PSD）
     */
    async getImagePreview(imagePath: string, maxSize: number = 800): Promise<{
        success: boolean;
        imageData?: string;
        base64?: string;  // 兼容旧接口
        dimensions?: { width: number; height: number };
        error?: string;
    }> {
        try {
            if (!fs.existsSync(imagePath)) {
                return { success: false, error: '文件不存在' };
            }

            const ext = path.extname(imagePath).toLowerCase();
            
            // PSD/PSB 文件特殊处理
            if (ext === '.psd' || ext === '.psb') {
                return await this.getPsdPreview(imagePath, maxSize);
            }

            // 常规图片使用 Sharp
            const sharpInstance = sharp(imagePath, { failOnError: false });
            const metadata = await sharpInstance.metadata();
            
            // 检查是否为支持的格式
            if (!metadata.format) {
                return { success: false, error: '不支持的图片格式' };
            }
            
            const buffer = await sharp(imagePath, { failOnError: false })
                .resize(maxSize, maxSize, { fit: 'inside' })
                .jpeg({ quality: 85 })
                .toBuffer();

            const base64Data = buffer.toString('base64');
            return {
                success: true,
                imageData: base64Data,
                base64: base64Data,
                dimensions: {
                    width: metadata.width || 0,
                    height: metadata.height || 0
                }
            };
        } catch (e) {
            return {
                success: false,
                error: `读取图片失败: ${e instanceof Error ? e.message : e}`
            };
        }
    }

    /**
     * 获取 PSD/PSB 文件预览
     * 
     * 注意：PSB 文件可能非常大，需要特殊处理
     */
    private async getPsdPreview(psdPath: string, maxSize: number = 800): Promise<{
        success: boolean;
        imageData?: string;
        base64?: string;
        dimensions?: { width: number; height: number };
        error?: string;
    }> {
        const cacheKey = `${psdPath}:${maxSize}`;
        try {
            // 检查缓存
            const cached = this.psdPreviewCache.get(cacheKey);
            if (cached && (Date.now() - cached.timestamp) < this.psdCacheExpiry) {
                console.log(`[ResourceManager] 使用 PSD 缓存: ${path.basename(psdPath)}`);
                return cached.result;
            }
            
            console.log(`[ResourceManager] 解析 PSD/PSB: ${psdPath}`);
            
            // 检查文件大小
            const stats = fs.statSync(psdPath);
            const fileSizeMB = stats.size / (1024 * 1024);
            console.log(`[ResourceManager] 文件大小: ${fileSizeMB.toFixed(1)} MB`);
            
            // 超大文件（>2GB）直接返回占位符，避免内存溢出
            // 提高阈值，尝试读取内嵌缩略图
            if (fileSizeMB > 2000) {
                console.warn(`[ResourceManager] 文件过大，跳过预览: ${psdPath}`);
                const result = {
                    success: false,
                    error: `文件过大 (${fileSizeMB.toFixed(0)}MB)，暂不支持预览`
                };
                this.psdPreviewCache.set(cacheKey, { result, timestamp: Date.now() });
                return result;
            }
            
            // 异步读取文件（对于大文件，使用流式读取可能更好，但 ag-psd 需要 Buffer）
            // 注意：Node.js Buffer 最大限制约 2GB
            const buffer = await fs.promises.readFile(psdPath);
            
            // 确保 Canvas 已初始化
            ensurePsdCanvasInitialized();
            
            // 解析 PSD/PSB：
            // 1) 读取合成图原始像素（用于高质量预览）
            // 2) 读取 raw 缩略图（作为备用）
            const parseOptions = { 
                skipLayerImageData: true, 
                skipCompositeImageData: false,
                skipThumbnail: false,
                useRawThumbnail: true,
                useImageData: true
            };
            
            const psd = readPsd(buffer, parseOptions as any) as any;

            // 优先使用合成图像素数据（分辨率最高）
            const composite = psd.imageData;
            const compositeW = composite?.width || 0;
            const compositeH = composite?.height || 0;
            const compositeData = composite?.data;
            const compositePixels = compositeW * compositeH;
            const MAX_COMPOSITE_PIXELS = 80000000; // 约 320MB RGBA 原始数据
            if (
                compositeData &&
                compositeW > 0 &&
                compositeH > 0 &&
                compositePixels > 0 &&
                compositePixels <= MAX_COMPOSITE_PIXELS
            ) {
                try {
                    const compositeBuffer = await sharp(Buffer.from(compositeData), {
                        raw: { width: compositeW, height: compositeH, channels: 4 }
                    })
                        .resize(maxSize, maxSize, { fit: 'inside', kernel: 'lanczos3' })
                        .sharpen({ sigma: 1.1, m1: 1, m2: 2.5, x1: 2, y2: 10, y3: 20 })
                        .jpeg({ quality: 96, mozjpeg: true, chromaSubsampling: '4:4:4' })
                        .toBuffer();

                    const base64Data = compositeBuffer.toString('base64');
                    const result = {
                        success: true,
                        imageData: base64Data,
                        base64: base64Data,
                        dimensions: {
                            width: psd.width || compositeW,
                            height: psd.height || compositeH
                        }
                    };
                    this.psdPreviewCache.set(cacheKey, { result, timestamp: Date.now() });
                    console.log('[ResourceManager] 使用 PSD 合成图生成高质量预览');
                    return result;
                } catch (compositeError: any) {
                    console.warn(`[ResourceManager] 合成图路径失败，降级到缩略图路径: ${compositeError?.message || compositeError}`);
                }
            }
            
            // 优先使用原始缩略图（JPEG 字节）
            const rawThumb = psd.imageResources?.thumbnailRaw;
            if (rawThumb?.data && rawThumb.data.length > 0) {
                try {
                    const outputBuffer = await sharp(Buffer.from(rawThumb.data))
                        .resize(maxSize, maxSize, { fit: 'inside', kernel: 'lanczos3' })
                        .sharpen({ sigma: 1.1, m1: 1, m2: 2.5, x1: 2, y2: 10, y3: 20 })
                        .jpeg({ quality: 96, mozjpeg: true, chromaSubsampling: '4:4:4' })
                        .toBuffer();
                    
                    const base64Data = outputBuffer.toString('base64');
                    const result = {
                        success: true,
                        imageData: base64Data,
                        base64: base64Data,
                        dimensions: {
                            width: psd.width || rawThumb.width || 0,
                            height: psd.height || rawThumb.height || 0
                        }
                    };
                    this.psdPreviewCache.set(cacheKey, { result, timestamp: Date.now() });
                    return result;
                } catch (thumbError: any) {
                    console.warn(`[ResourceManager] raw 缩略图解析失败，尝试其他路径: ${thumbError?.message || thumbError}`);
                }
            }

            // 兼容旧路径：如果拿到的是 Canvas thumbnail，尝试 toDataURL 解码
            const canvasThumb = psd.imageResources?.thumbnail;
            if (canvasThumb && typeof canvasThumb.toDataURL === 'function') {
                try {
                    const dataUrl: string = canvasThumb.toDataURL('image/jpeg', 1) || '';
                    const base64Raw = dataUrl.startsWith('data:image/jpeg;base64,')
                        ? dataUrl.slice('data:image/jpeg;base64,'.length)
                        : '';
                    if (base64Raw) {
                        const resizedBuffer = await sharp(Buffer.from(base64Raw, 'base64'))
                            .resize(maxSize, maxSize, { fit: 'inside', kernel: 'lanczos3' })
                            .sharpen({ sigma: 1.1, m1: 1, m2: 2.5, x1: 2, y2: 10, y3: 20 })
                            .jpeg({ quality: 96, mozjpeg: true, chromaSubsampling: '4:4:4' })
                            .toBuffer();
                        
                        const base64Data = resizedBuffer.toString('base64');
                        const result = {
                            success: true,
                            imageData: base64Data,
                            base64: base64Data,
                            dimensions: {
                                width: psd.width || canvasThumb.width || 0,
                                height: psd.height || canvasThumb.height || 0
                            }
                        };
                        this.psdPreviewCache.set(cacheKey, { result, timestamp: Date.now() });
                        return result;
                    }
                } catch (thumbError: any) {
                    console.warn(`[ResourceManager] canvas 缩略图解析失败，尝试合成图像: ${thumbError?.message || thumbError}`);
                }
            }
            
            // PSD 没有内嵌缩略图，或者解析失败
            // 尝试使用 Sharp 直接读取源文件（Sharp 会尝试读取 PSD/PSB 的合成视图）
            console.log('[ResourceManager] 无内嵌缩略图或解析失败，尝试使用 Sharp 读取合成图...');
            try {
                // 使用文件路径让 Sharp 处理，避免大文件 Buffer 拷贝
                // Sharp (libvips) 对 PSD/PSB 的支持取决于合成数据是否存在
                const sharpBuffer = await sharp(psdPath, { failOnError: false })
                    .resize(maxSize, maxSize, { fit: 'inside', kernel: 'lanczos3' })
                    .sharpen({ sigma: 1.1, m1: 1, m2: 2.5, x1: 2, y2: 10, y3: 20 })
                    .jpeg({ quality: 94, mozjpeg: true, chromaSubsampling: '4:4:4' })
                    .toBuffer();
                
                const base64Data = sharpBuffer.toString('base64');
                const result = {
                    success: true,
                    imageData: base64Data,
                    base64: base64Data,
                    dimensions: {
                        width: psd.width,
                        height: psd.height
                    }
                };
                
                // 缓存结果
                this.psdPreviewCache.set(cacheKey, { result, timestamp: Date.now() });
                console.log('[ResourceManager] Sharp 合成图读取成功');
                return result;
            } catch (sharpError: any) {
                console.warn('[ResourceManager] Sharp 读取合成图失败:', sharpError.message);
            }

            // 如果都失败了，返回基本信息（尺寸），前端可显示占位符
            const result = { 
                success: false, 
                error: 'PSD 文件没有内嵌缩略图且无法读取合成图',
                dimensions: {
                    width: psd.width,
                    height: psd.height
                }
            };
            this.psdPreviewCache.set(cacheKey, { result, timestamp: Date.now() });
            return result;
        } catch (e) {
            console.error(`[ResourceManager] PSD 解析失败: ${psdPath}`, e);
            const result = {
                success: false,
                error: `PSD 解析失败: ${e instanceof Error ? e.message : e}`
            };
            this.psdPreviewCache.set(cacheKey, { result, timestamp: Date.now() });
            return result;
        }
    }

    /**
     * 搜索资源文件
     */
    async searchResources(
        query: string,
        options: {
            directory?: string;
            type?: 'image' | 'design' | 'all';
            limit?: number;
        } = {}
    ): Promise<ResourceFile[]> {
        const { directory, type = 'all', limit = 20 } = options;
        
        const scanResult = await this.scanDirectory(directory || this.projectRoot, {
            recursive: true,
            includeDesignFiles: type !== 'image'
        });

        const queryLower = query.toLowerCase();
        
        let results = scanResult.files.filter(file => {
            // 类型筛选
            if (type !== 'all' && file.type !== type) {
                return false;
            }
            
            // 名称匹配
            return file.name.toLowerCase().includes(queryLower) ||
                   file.relativePath.toLowerCase().includes(queryLower);
        });

        // 按相关性排序（名称完全匹配优先）
        results.sort((a, b) => {
            const aExact = a.name.toLowerCase() === queryLower ? 0 : 1;
            const bExact = b.name.toLowerCase() === queryLower ? 0 : 1;
            if (aExact !== bExact) return aExact - bExact;
            
            // 按修改时间排序（新的优先）
            return b.modifiedTime.getTime() - a.modifiedTime.getTime();
        });

        return results.slice(0, limit);
    }

    /**
     * 按类别分组资源
     */
    async getResourcesByCategory(directory?: string): Promise<{
        products: ResourceFile[];      // 产品图
        backgrounds: ResourceFile[];   // 背景
        elements: ResourceFile[];      // 装饰元素
        references: ResourceFile[];    // 参考图
        others: ResourceFile[];        // 其他
    }> {
        const scanResult = await this.scanDirectory(directory || this.projectRoot);
        
        const categories = {
            products: [] as ResourceFile[],
            backgrounds: [] as ResourceFile[],
            elements: [] as ResourceFile[],
            references: [] as ResourceFile[],
            others: [] as ResourceFile[]
        };

        const keywords = {
            products: ['产品', 'product', '主图', 'main', '商品', 'item', '实拍', '白底'],
            backgrounds: ['背景', 'bg', 'background', '底图', '底纹'],
            elements: ['元素', 'element', '装饰', 'decor', 'icon', '图标', '标签', 'tag', '促销'],
            references: ['参考', 'ref', 'reference', '灵感', '样式', 'style', '模板', 'template']
        };

        for (const file of scanResult.files) {
            if (file.type !== 'image') continue;
            
            const nameLower = file.name.toLowerCase();
            const pathLower = file.relativePath.toLowerCase();
            const searchStr = nameLower + ' ' + pathLower;

            let categorized = false;
            for (const [category, keys] of Object.entries(keywords)) {
                if (keys.some(k => searchStr.includes(k))) {
                    categories[category as keyof typeof categories].push(file);
                    categorized = true;
                    break;
                }
            }

            if (!categorized) {
                categories.others.push(file);
            }
        }

        return categories;
    }

    /**
     * 获取目录结构（用于 AI 理解）
     */
    async getDirectoryStructure(directory?: string, maxDepth: number = 3): Promise<string> {
        const targetPath = directory || this.projectRoot;
        
        if (!targetPath || !fs.existsSync(targetPath)) {
            return '目录不存在或未设置';
        }

        const lines: string[] = [];
        lines.push(`📁 ${path.basename(targetPath)}/`);

        const buildTree = (dirPath: string, prefix: string = '', depth: number = 0) => {
            if (depth >= maxDepth) return;

            try {
                const entries = fs.readdirSync(dirPath, { withFileTypes: true });
                const filtered = entries.filter(e => 
                    !e.name.startsWith('.') && e.name !== 'node_modules'
                );

                filtered.forEach((entry, index) => {
                    const isLast = index === filtered.length - 1;
                    const connector = isLast ? '└── ' : '├── ';
                    const fullPath = path.join(dirPath, entry.name);

                    if (entry.isDirectory()) {
                        // 统计目录中的图片数量
                        const imageCount = this.countImages(fullPath);
                        const suffix = imageCount > 0 ? ` (${imageCount} 张图片)` : '';
                        lines.push(`${prefix}${connector}📁 ${entry.name}/${suffix}`);
                        
                        const newPrefix = prefix + (isLast ? '    ' : '│   ');
                        buildTree(fullPath, newPrefix, depth + 1);
                    } else {
                        const ext = path.extname(entry.name).toLowerCase();
                        if (IMAGE_EXTENSIONS.includes(ext)) {
                            lines.push(`${prefix}${connector}🖼️ ${entry.name}`);
                        } else if (DESIGN_EXTENSIONS.includes(ext)) {
                            lines.push(`${prefix}${connector}🎨 ${entry.name}`);
                        }
                    }
                });
            } catch (e) {
                // 忽略无法读取的目录
            }
        };

        buildTree(targetPath, '');
        return lines.join('\n');
    }

    /**
     * 统计目录中的图片数量
     */
    private countImages(dirPath: string): number {
        try {
            let count = 0;
            const entries = fs.readdirSync(dirPath, { withFileTypes: true });
            
            for (const entry of entries) {
                if (entry.isFile()) {
                    const ext = path.extname(entry.name).toLowerCase();
                    if (IMAGE_EXTENSIONS.includes(ext)) {
                        count++;
                    }
                }
            }
            
            return count;
        } catch {
            return 0;
        }
    }

    /**
     * 读取图片为 Base64（用于置入操作）
     */
    async readImageAsBase64(imagePath: string): Promise<{
        success: boolean;
        base64?: string;
        mimeType?: string;
        dimensions?: { width: number; height: number };
        assetId?: string;
        checksum?: string;
        byteLength?: number;
        sha256?: string;
        error?: string;
    }> {
        try {
            if (!fs.existsSync(imagePath)) {
                return { success: false, error: '文件不存在' };
            }

            const ext = path.extname(imagePath).toLowerCase();
            if (!IMAGE_EXTENSIONS.includes(ext)) {
                return { success: false, error: '不支持的图片格式' };
            }

            const buffer = fs.readFileSync(imagePath);
            const metadata = await sharp(imagePath).metadata();
            const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
            const checksum = this.calcChecksum(buffer);
            
            const mimeTypes: Record<string, string> = {
                '.jpg': 'image/jpeg',
                '.jpeg': 'image/jpeg',
                '.png': 'image/png',
                '.gif': 'image/gif',
                '.webp': 'image/webp',
                '.bmp': 'image/bmp',
                '.tiff': 'image/tiff',
                '.tif': 'image/tiff'
            };

            return {
                success: true,
                base64: buffer.toString('base64'),
                mimeType: mimeTypes[ext] || 'image/jpeg',
                assetId: sha256,
                checksum,
                byteLength: buffer.length,
                sha256,
                dimensions: {
                    width: metadata.width || 0,
                    height: metadata.height || 0
                }
            };
        } catch (e) {
            return {
                success: false,
                error: `读取图片失败: ${e instanceof Error ? e.message : e}`
            };
        }
    }

    /**
     * 只读图片文件探针：用于验收链路确认导出图是否存在、可解码、尺寸是否可复核。
     * 不返回原始图片内容或 base64，避免把结果图泄漏到普通报告链路。
     */
    async probeImageFile(imagePath: string): Promise<{
        success: boolean;
        path: string;
        status: 'ok' | 'missing' | 'not_file' | 'unsupported' | 'decode_failed';
        exists: boolean;
        isFile: boolean;
        byteLength?: number;
        format?: string;
        mimeType?: string;
        dimensions?: { width: number; height: number };
        visualMetrics?: ImageVisualMetricsProbe;
        sha256?: string;
        rawImagesRedacted: true;
        error?: string;
    }> {
        const normalizedPath = path.resolve(String(imagePath || ''));
        const base = {
            path: normalizedPath,
            rawImagesRedacted: true as const
        };
        try {
            if (!fs.existsSync(normalizedPath)) {
                return {
                    ...base,
                    success: false,
                    status: 'missing',
                    exists: false,
                    isFile: false,
                    error: '文件不存在'
                };
            }

            const stats = fs.statSync(normalizedPath);
            if (!stats.isFile()) {
                return {
                    ...base,
                    success: false,
                    status: 'not_file',
                    exists: true,
                    isFile: false,
                    error: '目标不是文件'
                };
            }

            const ext = path.extname(normalizedPath).toLowerCase();
            if (!IMAGE_EXTENSIONS.includes(ext)) {
                return {
                    ...base,
                    success: false,
                    status: 'unsupported',
                    exists: true,
                    isFile: true,
                    byteLength: stats.size,
                    format: ext.replace(/^\./, ''),
                    error: '不支持的图片格式'
                };
            }

            const metadata = await sharp(normalizedPath).metadata();
            const visualMetrics = await buildImageVisualMetricsProbe(normalizedPath);
            const buffer = fs.readFileSync(normalizedPath);
            const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
            const mimeTypes: Record<string, string> = {
                '.jpg': 'image/jpeg',
                '.jpeg': 'image/jpeg',
                '.png': 'image/png',
                '.gif': 'image/gif',
                '.webp': 'image/webp',
                '.bmp': 'image/bmp',
                '.tiff': 'image/tiff',
                '.tif': 'image/tiff'
            };

            return {
                ...base,
                success: true,
                status: 'ok',
                exists: true,
                isFile: true,
                byteLength: stats.size,
                format: String(metadata.format || ext.replace(/^\./, '')),
                mimeType: mimeTypes[ext] || 'image/jpeg',
                dimensions: {
                    width: metadata.width || 0,
                    height: metadata.height || 0
                },
                visualMetrics,
                sha256
            };
        } catch (e) {
            return {
                ...base,
                success: false,
                status: 'decode_failed',
                exists: fs.existsSync(normalizedPath),
                isFile: fs.existsSync(normalizedPath) ? fs.statSync(normalizedPath).isFile() : false,
                error: `图片探针失败: ${e instanceof Error ? e.message : e}`
            };
        }
    }

    /**
     * 只读图片像素探针：比较参考图与结果图的粗粒度亮度/暗部轮廓相似度。
     * 不返回原始图片内容或 base64；该指标只能用于 QA 检查，不能作为审美验收。
     */
    async compareImageFiles(referencePath: string, resultPath: string, options?: {
        targetSize?: { width?: number; height?: number };
        thresholds?: {
            maxMae?: number;
            maxHighDeltaRatio?: number;
            minDarkJaccard?: number;
            minSoftDarkJaccard?: number;
            softMaskBlurSigma?: number;
            softMaskDarkThreshold?: number;
        };
    }): Promise<{
        success: boolean;
        status: PixelProbeStatus;
        mode: 'pixel-probe';
        referencePath: string;
        resultPath: string;
        width?: number;
        height?: number;
        mae?: number;
        rmse?: number;
        highDeltaRatio?: number;
        darkJaccard?: number;
        softDarkJaccard?: number;
        softMaskBlurSigma?: number;
        softMaskDarkThreshold?: number;
        referenceDarkPixels?: number;
        resultDarkPixels?: number;
        summary?: string;
        boundary: string;
        rawImagesRedacted: true;
        error?: string;
    }> {
        const normalizedReferencePath = path.resolve(String(referencePath || ''));
        const normalizedResultPath = path.resolve(String(resultPath || ''));
        const boundary = 'Pixel probe only. It checks coarse screenshot similarity and antialias-tolerant dark-shape overlap; it is not a high-fidelity design acceptance score.';
        const base = {
            mode: 'pixel-probe' as const,
            referencePath: normalizedReferencePath,
            resultPath: normalizedResultPath,
            boundary,
            rawImagesRedacted: true as const
        };

        try {
            const referenceProbe = await this.probeImageFile(normalizedReferencePath);
            if (!referenceProbe.success || referenceProbe.status !== 'ok') {
                return {
                    ...base,
                    success: false,
                    status: 'unverified',
                    summary: '参考图不可用于像素探针。',
                    error: referenceProbe.error || referenceProbe.status
                };
            }

            const resultProbe = await this.probeImageFile(normalizedResultPath);
            if (!resultProbe.success || resultProbe.status !== 'ok') {
                return {
                    ...base,
                    success: false,
                    status: 'unverified',
                    summary: '结果图不可用于像素探针。',
                    error: resultProbe.error || resultProbe.status
                };
            }

            const width = toPositiveInt(
                options?.targetSize?.width,
                resultProbe.dimensions?.width || referenceProbe.dimensions?.width || 800
            );
            const height = toPositiveInt(
                options?.targetSize?.height,
                resultProbe.dimensions?.height || referenceProbe.dimensions?.height || 800
            );
            const thresholds = {
                maxMae: Number(options?.thresholds?.maxMae ?? 18),
                maxHighDeltaRatio: Number(options?.thresholds?.maxHighDeltaRatio ?? 0.18),
                minDarkJaccard: Number(options?.thresholds?.minDarkJaccard ?? 0.62),
                minSoftDarkJaccard: Number(options?.thresholds?.minSoftDarkJaccard ?? options?.thresholds?.minDarkJaccard ?? 0.62),
                softMaskBlurSigma: Number(options?.thresholds?.softMaskBlurSigma ?? 1.5),
                softMaskDarkThreshold: Number(options?.thresholds?.softMaskDarkThreshold ?? 180)
            };

            const referenceRaw = await readLumaRawForProbe(normalizedReferencePath, width, height);
            const resultRaw = await readLumaRawForProbe(normalizedResultPath, width, height);
            const hardMetrics = compareLumaRawForProbe(referenceRaw, resultRaw);
            const softReferenceRaw = await readLumaRawForProbe(normalizedReferencePath, width, height, thresholds.softMaskBlurSigma);
            const softResultRaw = await readLumaRawForProbe(normalizedResultPath, width, height, thresholds.softMaskBlurSigma);
            const softMetrics = compareLumaRawForProbe(softReferenceRaw, softResultRaw, thresholds.softMaskDarkThreshold);

            const darkShapeMatches = hardMetrics.darkJaccard >= thresholds.minDarkJaccard
                || softMetrics.darkJaccard >= thresholds.minSoftDarkJaccard;
            const status: PixelProbeStatus = hardMetrics.mae <= thresholds.maxMae
                && hardMetrics.highDeltaRatio <= thresholds.maxHighDeltaRatio
                && darkShapeMatches
                ? 'ok'
                : 'watch';

            return {
                ...base,
                success: true,
                status,
                width,
                height,
                mae: roundMetric(hardMetrics.mae, 3),
                rmse: roundMetric(hardMetrics.rmse, 3),
                highDeltaRatio: roundMetric(hardMetrics.highDeltaRatio, 4),
                darkJaccard: roundMetric(hardMetrics.darkJaccard, 4),
                softDarkJaccard: roundMetric(softMetrics.darkJaccard, 4),
                softMaskBlurSigma: roundMetric(thresholds.softMaskBlurSigma, 2),
                softMaskDarkThreshold: roundMetric(thresholds.softMaskDarkThreshold, 0),
                referenceDarkPixels: hardMetrics.referenceDark,
                resultDarkPixels: hardMetrics.resultDark,
                summary: `pixelProbe=${status}; mae=${roundMetric(hardMetrics.mae, 3)}; highDeltaRatio=${roundMetric(hardMetrics.highDeltaRatio, 4)}; darkJaccard=${roundMetric(hardMetrics.darkJaccard, 4)}。`
            };
        } catch (e) {
            return {
                ...base,
                success: false,
                status: 'unverified',
                summary: '像素探针执行失败。',
                error: e instanceof Error ? e.message : String(e)
            };
        }
    }

    /**
     * 为 AI 生成资源摘要
     */
    async generateResourceSummary(directory?: string): Promise<string> {
        const scanResult = await this.scanDirectory(directory || this.projectRoot);
        const categories = await this.getResourcesByCategory(directory);

        const lines: string[] = [
            `📊 **项目资源概览**`,
            ``,
            `- 总图片数: ${scanResult.imageCount}`,
            `- 设计文件: ${scanResult.designCount}`,
            ``,
            `📁 **按类别分类**:`,
            `- 产品图: ${categories.products.length} 张`,
            `- 背景图: ${categories.backgrounds.length} 张`,
            `- 装饰元素: ${categories.elements.length} 张`,
            `- 参考图: ${categories.references.length} 张`,
            `- 其他: ${categories.others.length} 张`,
        ];

        // 列出一些示例文件
        if (categories.products.length > 0) {
            lines.push('', '🛍️ **产品图示例**:');
            categories.products.slice(0, 5).forEach(f => {
                lines.push(`  - ${f.relativePath}`);
            });
        }

        if (categories.backgrounds.length > 0) {
            lines.push('', '🖼️ **背景图示例**:');
            categories.backgrounds.slice(0, 5).forEach(f => {
                lines.push(`  - ${f.relativePath}`);
            });
        }

        return lines.join('\n');
    }

    /**
     * 获取一个视觉模型调用名额；满载时排队等待。
     * 名额由 releaseVisionCallSlot 直接移交（移交时计数不变），等待者被唤醒后不再递增。
     */
    private async acquireVisionCallSlot(): Promise<void> {
        if (this.visionCallActive < ResourceManagerService.VISION_CALL_MAX_CONCURRENCY) {
            this.visionCallActive++;
            return;
        }
        await new Promise<void>((resolve) => {
            this.visionCallWaiters.push(resolve);
        });
    }

    /**
     * 释放视觉模型调用名额；若有等待者则把名额直接移交给队首，
     * 避免“先递减再唤醒”的窗口期被新请求插队导致超过并发上限。
     */
    private releaseVisionCallSlot(): void {
        const next = this.visionCallWaiters.shift();
        if (next) {
            next();
            return;
        }
        this.visionCallActive--;
    }

    /**
     * 在视觉模型并发闸门内执行任务（同时最多 VISION_CALL_MAX_CONCURRENCY 路）
     */
    private async runWithVisionCallGate<T>(task: () => Promise<T>): Promise<T> {
        await this.acquireVisionCallSlot();
        try {
            return await task();
        } finally {
            this.releaseVisionCallSlot();
        }
    }

    /**
     * 构造素材分析缓存键：imagePath + mtimeMs + size + 分析版本。
     * 文件内容变化后自动失效；分析提示词/分辨率升级时提升版本号，
     * 防止旧版本分析结果（如 512px 无 visibleText 时代）污染新语义。
     */
    private static readonly ASSET_ANALYSIS_VERSION = 'v5-selling-point-analysis';

    private buildAssetAnalysisCacheKey(imagePath: string): string {
        const stat = fs.statSync(imagePath);
        return `${imagePath}|mtime:${stat.mtimeMs}|size:${stat.size}|${ResourceManagerService.ASSET_ANALYSIS_VERSION}`;
    }

    /**
     * 写入素材分析缓存。简单 LRU：重新插入刷新顺序（Map 迭代顺序 = 插入顺序），
     * 超过上限时删除最老的条目。
     */
    private storeAssetAnalysisInCache(cacheKey: string, analysis: AssetContentAnalysis): void {
        this.assetAnalysisCache.delete(cacheKey);
        this.assetAnalysisCache.set(cacheKey, structuredClone(analysis));
        while (this.assetAnalysisCache.size > ResourceManagerService.ASSET_ANALYSIS_CACHE_MAX_ENTRIES) {
            const oldestKey = this.assetAnalysisCache.keys().next().value;
            if (oldestKey === undefined) break;
            this.assetAnalysisCache.delete(oldestKey);
        }
    }

    /**
     * 分析素材图片内容（使用视觉模型）
     *
     * 性能收口（所有渲染端入口都经 IPC 'resource:analyzeAsset' 汇聚到这里）：
     * 1. 结果缓存：同一文件内容（路径 + mtimeMs + size）的成功分析进程内只做一次，命中时附 fromCache: true；
     * 2. in-flight 合并：同 key 并发请求共享同一个分析 Promise；
     * 3. 并发闸门：视觉模型调用经 runWithVisionCallGate 限流，避免本地模型显存争抢。
     */
    async analyzeAssetContent(
        imagePath: string,
        visionModelCall: (imageBase64: string, prompt: string) => Promise<string>
    ): Promise<AssetContentAnalysisResult> {
        let cacheKey: string;
        try {
            cacheKey = this.buildAssetAnalysisCacheKey(imagePath);
        } catch (e) {
            return {
                success: false,
                error: `分析失败：无法读取素材文件状态（${imagePath}）：${e instanceof Error ? e.message : e}`
            };
        }

        // 结果缓存命中：直接返回缓存副本（防止调用方改动污染缓存）
        const cachedAnalysis = this.assetAnalysisCache.get(cacheKey);
        if (cachedAnalysis) {
            // 命中时重新插入，刷新 LRU 顺序
            this.assetAnalysisCache.delete(cacheKey);
            this.assetAnalysisCache.set(cacheKey, cachedAnalysis);
            return { success: true, analysis: structuredClone(cachedAnalysis), fromCache: true };
        }

        // in-flight 合并：同 key 并发请求共享同一个 Promise
        const inFlight = this.assetAnalysisInFlight.get(cacheKey);
        if (inFlight) {
            return inFlight;
        }

        const analysisTask = this.performAssetContentAnalysis(imagePath, visionModelCall)
            .then((result) => {
                if (result.success && result.analysis) {
                    this.storeAssetAnalysisInCache(cacheKey, result.analysis);
                }
                return result;
            })
            .finally(() => {
                this.assetAnalysisInFlight.delete(cacheKey);
            });
        this.assetAnalysisInFlight.set(cacheKey, analysisTask);
        return analysisTask;
    }

    /**
     * 真正执行一次素材视觉分析（无缓存路径），仅由 analyzeAssetContent 收口调用
     */
    private async performAssetContentAnalysis(
        imagePath: string,
        visionModelCall: (imageBase64: string, prompt: string) => Promise<string>
    ): Promise<AssetContentAnalysisResult> {
        try {
            // 768px：色卡/挂卡图上常印有产品编号、颜色名等小字，512px 缩图读不出来
            const previewResult = await this.getImagePreview(imagePath, 768);
            if (!previewResult.success || !previewResult.imageData) {
                return { success: false, error: previewResult.error };
            }
            const previewImageData = previewResult.imageData;

            const prompt = `Analyze this e-commerce asset image and return JSON only.
If the image contains printed text (product code, color names, brand name, labels), transcribe it verbatim into "visibleText".
{
  "visibleText": "图片上印的文字原样转写（无则空字符串）",
  "description": "Brief visual summary within 20 Chinese characters",
  "assetNature": "raw_photo | finished_design",
  "category": "product_main | product_detail | scene | background | decorative_element | person | text_label | other",
  "mainSubject": "Main visible subject",
  "subjectCoverageRatio": "dominant | moderate | small",
  "subjectPosition": "center | top | bottom | left | right | scattered",
  "compositionFocus": "一句话：画面视觉重心实际落在什么上（如『袜子/腿部』或『裙子/上半身』）",
  "mainImageSuitability": "suitable | marginal | unsuitable",
  "mainImageSuitabilityReason": "简短理由，说明为什么适合/不适合做突出该商品的主图",
  "shotType": "flat_lay | on_model | detail_closeup | package | chart | scene | other",
  "sellingPointObservations": ["「图中可见什么」→ 可支持「什么卖点」", "..."],
  "colors": ["#RRGGBB", "#RRGGBB", "#RRGGBB"],
  "style": "Short style phrase such as minimal / elegant / lively / cute / premium",
  "suggestedPlacement": "Suggested detail-page usage such as hero image / selling point / detail close-up / footer support",
  "suggestedEffects": ["clipping_mask", "drop_shadow"]
}

"assetNature" — judge from the VISUAL CONTENT (never the filename) what this asset really is:
- "raw_photo": an original camera shot of the product or model — the frame is just the merchandise/person itself, with no designer markup. This is usable RAW MATERIAL for building new designs.
- "finished_design": already produced by a designer — shows editing traces such as overlaid marketing / selling-point text blocks, an arranged multi-image collage or spec/SKU grid, price or promo badges, or a clean listing white-background cutout. This is a DELIVERABLE, not raw material — it must NOT be dropped into a new design as if it were a photo.
When unsure, look for human design intent (typeset text, aligned modules, composited layout) → finished_design; a plain photographed scene → raw_photo.

Composition fields for IMAGE SELECTION — judge ONLY from the visual content (never the filename), thinking like an e-commerce art director choosing a main/hero image:
- The "subject" is the actual merchandise being sold in this project (e.g. for legwear it is the socks themselves, for apparel the garment, for shoes the footwear) — NOT the model's other clothing, the scene, or the background.
- "subjectCoverageRatio": dominant = the product fills most of the frame; moderate = clearly present but shares the frame with other elements; small = the product is only a minor part of the frame.
- "subjectPosition": where the product itself sits in the frame.
- "compositionFocus": state plainly what the visual weight actually lands on. If the product is small or low and attention goes to other elements (e.g. a skirt, the upper body, the background), say so.
- "mainImageSuitability": "suitable" only when the product is the clear, prominent subject of the frame; "marginal" when it is visible but not spotlighted; "unsuitable" when the product is small / peripheral / lost in a busy scene. A main image must spotlight the product being sold.

Selling-point observations — classify the asset the way a designer tags material for selling-point extraction:
- "shotType": flat_lay = product laid flat / arranged without a person (typically shows fabric, texture, colorways, craftsmanship); on_model = worn on a person (typically shows stretch, fit, styling, wearing scenarios); detail_closeup = macro/close crop of one feature (stitching, cuff, sole, weave); package = retail packaging; chart = color card / size chart / spec sheet.
- "sellingPointObservations": list what is actually visible in this image and which selling point that observation can support, each entry as 「图中可见的事实 → 可支撑的卖点」 (e.g. 「模特脚踝处袜口自然拉伸无勒痕 → 弹力舒适/不勒脚」「平铺可见细密针织纹理 → 面料工艺」「同款五个颜色并排 → 多色可选」). STRICT rule: only report what is actually visible in THIS image — no speculation, no generic claims like 舒适透气 without visible support. Empty array if the image shows nothing specific.

Allowed suggestedEffects:
- "clipping_mask"
- "drop_shadow"
- "rounded_corner"
- "stroke_emphasis"
- "blurred_background"
- "color_tuning"
- "direct_use"

Return JSON only.`;

            // 视觉模型调用过并发闸门，限制同时进行的推理路数
            const response = await this.runWithVisionCallGate(() => visionModelCall(
                `data:image/jpeg;base64,${previewImageData}`,
                prompt
            ));

            const extracted = extractModelJsonObject(response);
            if (extracted) {
                return { success: true, analysis: extracted.value };
            }

            return {
                success: false,
                error: `解析视觉分析结果失败：模型输出中没有可修复的 JSON 对象（输出前 120 字符：${String(response || '').slice(0, 120)}）`
            };
        } catch (e) {
            return {
                success: false,
                error: `分析失败: ${e instanceof Error ? e.message : e}`
            };
        }
    }

    /**
     * 测量参考图构图（"该多大"的参照依据 · 只读不落盘）
     *
     * 链路：读参考图（位图或 PSD/PSB 合成预览）→ 本地主体检测（抠图 ONNX，坐标缩放回原尺寸）
     * → composition-metrics 纯逻辑求构图数值与 fitLayerSubjectToRegion 应用建议。
     * 不用视觉模型（确定性测量，0 token）；主体检测失败时如实报错，不编造占比。
     */
    async measureReferenceComposition(imagePath: string): Promise<{
        success: boolean;
        measurement?: ReturnType<typeof measureComposition>;
        source?: {
            imagePath: string;
            canvas: { width: number; height: number };
            subjectBounds: { left: number; top: number; right: number; bottom: number };
            detectionMethod?: string;
        };
        error?: string;
    }> {
        const normalizedPath = String(imagePath || '').trim();
        if (!normalizedPath) {
            return { success: false, error: '构图测量失败：缺少参考图路径 imagePath。' };
        }
        // 1024px 预览：主体检测对边缘敏感，比素材分析的 768 略高
        const preview = await this.getImagePreview(normalizedPath, 1024);
        if (!preview.success || !preview.imageData) {
            return { success: false, error: `构图测量失败：无法读取参考图（${normalizedPath}）：${preview.error || '未知原因'}` };
        }
        const canvasWidth = preview.dimensions?.width || 0;
        const canvasHeight = preview.dimensions?.height || 0;
        if (canvasWidth <= 0 || canvasHeight <= 0) {
            return { success: false, error: `构图测量失败：读不到参考图原始尺寸（${normalizedPath}）。` };
        }

        const detection = await getSubjectDetectionService().detectSubjectBounds(
            `data:image/jpeg;base64,${preview.imageData}`,
            {
                originalImageWidth: canvasWidth,
                originalImageHeight: canvasHeight
            }
        );
        if (!detection.success || !detection.bounds) {
            return {
                success: false,
                error: `构图测量失败：参考图主体检测未命中（${normalizedPath}）：${detection.error || '主体不明显或为纯背景图'}。如参考是氛围/背景图，无需按主体占比参照。`
            };
        }

        const subjectBounds = {
            left: detection.bounds.left,
            top: detection.bounds.top,
            right: detection.bounds.right,
            bottom: detection.bounds.bottom
        };
        const measurement = measureComposition({
            canvas: { width: canvasWidth, height: canvasHeight },
            subjectBounds
        });
        if (!measurement.ok) {
            return { success: false, error: measurement.error };
        }
        return {
            success: true,
            measurement,
            source: {
                imagePath: normalizedPath,
                canvas: { width: canvasWidth, height: canvasHeight },
                subjectBounds,
                detectionMethod: detection.method
            }
        };
    }

    /**
     * 分析设计参考图为什么有效（使用视觉模型，只返回可复核经验观察）
     */
    async analyzeDesignReference(
        request: AnalyzeDesignReferenceRequest,
        visionModelCall: (imageBase64: string, prompt: string) => Promise<string>
    ): Promise<DesignReferenceAnalysisResult> {
        try {
            const imagePath = String(request?.imagePath || '').trim();
            if (!imagePath) {
                return { success: false, error: '缺少要分析的参考图路径。' };
            }

            const previewResult = await this.getImagePreview(imagePath, 768);
            if (!previewResult.success || !previewResult.imageData) {
                return { success: false, error: previewResult.error || '无法读取参考图预览。' };
            }

            const prompt = this.buildDesignReferenceAnalysisPrompt(request);
            const response = await visionModelCall(
                `data:image/jpeg;base64,${previewResult.imageData}`,
                prompt
            );
            const parsed = this.extractJsonObject(response);
            if (!parsed) {
                return {
                    success: false,
                    error: '设计参考分析没有返回可解析 JSON。',
                    rawModelTextRedacted: true
                };
            }

            const observation = this.normalizeDesignReferenceObservation(parsed);
            if (!observation) {
                return {
                    success: false,
                    error: '设计参考分析缺少理由、适用场景或可复用经验。',
                    rawModelTextRedacted: true
                };
            }

            return { success: true, observation };
        } catch (e) {
            return {
                success: false,
                error: `设计参考分析失败: ${e instanceof Error ? e.message : e}`,
                rawModelTextRedacted: true
            };
        }
    }

    private buildDesignReferenceAnalysisPrompt(request: AnalyzeDesignReferenceRequest): string {
        const title = this.cleanDesignReferenceText(request.referenceTitle).slice(0, 80) || '未命名参考图';
        const tags = this.normalizeDesignReferenceList(request.referenceTags).slice(0, 10);
        const topics = this.normalizeDesignReferenceList(request.topics).slice(0, 8);
        const source = this.cleanDesignReferenceText(request.referenceSource).slice(0, 40) || 'reference';
        const cadence = this.cleanDesignReferenceText(request.cadence).slice(0, 24) || 'manual';
        return `你是电商视觉设计总监，请分析这张参考图为什么值得学习。只返回 JSON，不要输出 Markdown，不要返回本地路径、base64、置信度、分数或调试字段。

参考上下文：
- 标题：${title}
- 来源：${source}
- 学习节奏：${cadence}
- 标签：${tags.join('、') || '无'}
- 本次学习主题：${topics.join('、') || '电商设计参考'}

请从电商设计角度判断，不要只描述图片内容。重点关注：
- 构图和主体关系：主体位置、大小、留白、基线、节奏、视觉重心。
- 选图与置入：为什么这样裁切/摆放更利于商品比较或卖点表达。
- 光影和精修：阴影方向、层次、质感保留、白底干净度。
- 色彩和风格：主色关系、背景/文字/商品的对比和品牌气质。
- 文案和排版：字号层级、标签位置、扫描顺序、是否适合主图/SKU/详情页。
- 适用与禁用：哪些品类/场景适合复用，哪些情况下不要强行套用。

返回 JSON 格式：
{
  "productCategory": "例如 socks / apparel / home / beauty / unknown",
  "designType": "例如 sku-color-card / main-image-reference / detail-page-reference / layout-reference",
  "summary": "用中文概括这张参考图的设计价值，不超过 80 字",
  "strengths": [
    {
      "aspect": "composition | placement | lighting | color | typography | retouching",
      "observation": "具体说好在哪儿，不要泛泛说好看",
      "reason": "解释为什么这个处理有效，必须是设计理由",
      "suitableFor": ["适用的设计场景"]
    }
  ],
  "suitableScenarios": ["适合复用的业务场景"],
  "avoidWhen": ["不适合套用的情况"],
  "reusableHeuristics": ["可复用的设计做法，写成动作原则"]
}

硬性要求：
- strengths 至少 3 条，其中至少包含 composition 或 placement，且至少包含 lighting、color、typography、retouching 中的一项。
- suitableScenarios 至少 2 条。
- avoidWhen 至少 1 条。
- reusableHeuristics 至少 3 条。
- 不要返回 confidence、score、localPath、imageBase64、rawImage、buffer、pixels。`;
    }

    private extractJsonObject(text: string): any | undefined {
        return extractModelJsonObject(text)?.value;
    }

    private normalizeDesignReferenceObservation(value: any): DesignReferenceAnalysisResult['observation'] | undefined {
        if (!value || typeof value !== 'object') return undefined;
        const summary = this.cleanDesignReferenceText(value.summary);
        const strengths = Array.isArray(value.strengths)
            ? value.strengths
                .map((item: any) => ({
                    aspect: this.cleanDesignReferenceText(item?.aspect),
                    observation: this.cleanDesignReferenceText(item?.observation),
                    reason: this.cleanDesignReferenceText(item?.reason),
                    suitableFor: this.normalizeDesignReferenceList(item?.suitableFor)
                }))
                .filter((item: { observation: string; reason: string }) => item.observation && item.reason)
            : [];
        const suitableScenarios = this.normalizeDesignReferenceList(value.suitableScenarios);
        const avoidWhen = this.normalizeDesignReferenceList(value.avoidWhen);
        const reusableHeuristics = this.normalizeDesignReferenceList(value.reusableHeuristics);

        if (!summary || strengths.length < 2 || suitableScenarios.length < 1 || reusableHeuristics.length < 1) {
            return undefined;
        }

        return {
            analysisSource: 'resource:analyzeDesignReference',
            productCategory: this.cleanDesignReferenceText(value.productCategory) || undefined,
            designType: this.cleanDesignReferenceText(value.designType) || undefined,
            summary,
            strengths,
            suitableScenarios,
            avoidWhen: avoidWhen.length ? avoidWhen : ['与当前商品事实、品牌调性或平台规范冲突时不要直接套用。'],
            reusableHeuristics,
            reviewStatus: 'needs_human_review',
            sourceNotes: ['analysis_adapter=resource:analyzeDesignReference'],
            limitations: ['该设计参考分析来自视觉模型，需要人工复核后才能进入长期知识。']
        };
    }

    private normalizeDesignReferenceList(value: unknown): string[] {
        if (!Array.isArray(value)) return [];
        return Array.from(new Set(value.map((item) => this.cleanDesignReferenceText(item)).filter(Boolean)));
    }

    private cleanDesignReferenceText(value: unknown): string {
        return String(value || '')
            .replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi, '[redacted]')
            .replace(/\b[A-Za-z]:[\\/][^\s"'，,；;]+/g, '[redacted-local-path]')
            .replace(/\bconfidence\b|置信度?|score|分数/gi, '[redacted]')
            .replace(/\s+/g, ' ')
            .trim();
    }

    /**
     * 智能推荐素材（根据设计需求）
     */
    private getRequirementKeywords(requirement: string): string[] {
        const raw = String(requirement || '')
            .toLowerCase()
            .split(/[\s,;:，。、“”'"!?()[\]{}\-_/\\|]+/)
            .map((k) => k.trim())
            .filter((k) => k.length >= 2);
        return Array.from(new Set(raw)).slice(0, 12);
    }

    private inferCategoryFromRequirement(requirement: string): 'products' | 'backgrounds' | 'elements' | 'references' | null {
        const text = String(requirement || '').toLowerCase();
        const categoryHints: Array<{ key: 'products' | 'backgrounds' | 'elements' | 'references'; words: string[] }> = [
            { key: 'products', words: ['产品', '商品', '主图', '款式', 'product', 'item', 'model'] },
            { key: 'backgrounds', words: ['背景', '底图', '场景底图', 'bg', 'background'] },
            { key: 'elements', words: ['元素', '装饰', '图标', '标签', 'icon', 'sticker'] },
            { key: 'references', words: ['参考', '风格', '版式', '样式', 'style', 'reference'] }
        ];

        for (const item of categoryHints) {
            if (item.words.some((word) => text.includes(word))) {
                return item.key;
            }
        }
        return null;
    }

    private fileMatchesCategory(file: ResourceFile, categoryKey: 'products' | 'backgrounds' | 'elements' | 'references'): boolean {
        const text = `${file.name} ${file.relativePath}`.toLowerCase();
        const keywords: Record<'products' | 'backgrounds' | 'elements' | 'references', string[]> = {
            products: ['产品', '商品', '主图', '款式', 'product', 'item', 'model'],
            backgrounds: ['背景', '底图', '场景', 'bg', 'background'],
            elements: ['元素', '装饰', '图标', '标签', 'element', 'icon'],
            references: ['参考', '风格', '版式', '样式', 'ref', 'style', 'template']
        };
        return keywords[categoryKey].some((word) => text.includes(word));
    }

    private clampScore(score: number): number {
        if (!Number.isFinite(score)) return 0;
        return Math.max(0, Math.min(100, Math.round(score)));
    }

    private scoreCandidateFile(
        file: ResourceFile,
        requirementKeywords: string[],
        inferredCategory: 'products' | 'backgrounds' | 'elements' | 'references' | null
    ): { score: number; reasons: string[] } {
        const searchText = `${file.name} ${file.relativePath}`.toLowerCase();
        let score = 12;
        const reasons: string[] = [];

        let keywordHits = 0;
        for (const keyword of requirementKeywords) {
            if (searchText.includes(keyword)) {
                keywordHits += 1;
                score += keywordHits === 1 ? 20 : 10;
                if (reasons.length < 2) {
                    reasons.push(`keyword match: ${keyword}`);
                }
            }
        }

        if (inferredCategory) {
            if (this.fileMatchesCategory(file, inferredCategory)) {
                score += 20;
                reasons.push(`category hint: ${inferredCategory}`);
            } else {
                score -= 8;
            }
        }

        const width = Number(file.dimensions?.width || 0);
        const height = Number(file.dimensions?.height || 0);
        if (width > 0 && height > 0) {
            const megaPixels = (width * height) / 1_000_000;
            score += Math.min(22, megaPixels * 4.5);
            if (megaPixels >= 1.2 && reasons.length < 3) {
                reasons.push(`high resolution: ${width}x${height}`);
            }
        }

        const ext = String(file.extension || '').toLowerCase();
        if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
            score += 3;
        }

        return {
            score: this.clampScore(score),
            reasons: reasons.slice(0, 3)
        };
    }

    private parseJsonObject<T>(input: string): T | null {
        return (extractModelJsonObject(input)?.value as T) ?? null;
    }

    /**
     * Recommend project assets based on requirement text and lightweight vision re-ranking.
     */
    async recommendAssets(
        requirement: string,
        visionModelCall: (imageBase64: string, prompt: string) => Promise<string>,
        options: {
            maxResults?: number;
            category?: string;
            deterministic?: boolean;
        } = {}
    ): Promise<{
        success: boolean;
        recommendations?: Array<{
            file: ResourceFile;
            matchScore: number;
            matchReason: string;
            suggestedUse: string;
        }>;
        error?: string;
    }> {
        const { maxResults = 5, category, deterministic = false } = options;

        try {
            const normalizedRequirement = String(requirement || '').trim() || 'find suitable project assets';
            const scanResult = await this.scanDirectory();
            let candidates = scanResult.files.filter((f) => f.type === 'image');

            if (category) {
                const categories = await this.getResourcesByCategory();
                candidates = categories[category as keyof typeof categories] || candidates;
            }

            if (candidates.length === 0) {
                return { success: true, recommendations: [] };
            }

            const requirementKeywords = this.getRequirementKeywords(normalizedRequirement);
            const inferredCategory = category ? null : this.inferCategoryFromRequirement(normalizedRequirement);

            const heuristicRanked = candidates
                .map((file) => {
                    const heuristic = this.scoreCandidateFile(file, requirementKeywords, inferredCategory);
                    return {
                        file,
                        heuristicScore: heuristic.score,
                        heuristicReason: heuristic.reasons.join(' / ') || 'base ranking'
                    };
                })
                .sort((a, b) => {
                    if (b.heuristicScore !== a.heuristicScore) return b.heuristicScore - a.heuristicScore;
                    if (deterministic) {
                        return String(a.file.path || '').localeCompare(String(b.file.path || ''));
                    }
                    return 0;
                })
                .slice(0, 12);

            const recommendations: Array<{
                file: ResourceFile;
                matchScore: number;
                matchReason: string;
                suggestedUse: string;
            }> = [];

            const visionCandidates = heuristicRanked.slice(0, 5);
            for (const candidate of visionCandidates) {
                let modelScore: number | undefined;
                let modelReason = '';
                let suggestedUse = '';

                try {
                    // 768px：320px 缩图太糊，难判断主体占画面比例/构图重心/留白，导致选图视觉评估失真；
                    // 与 analyzeAssetContent 的 768 预览口径对齐（仅提升看图输入清晰度，不改选图打分权重）。
                    const preview = await this.getImagePreview(candidate.file.path, 768);
                    if (preview.success && preview.imageData) {
                        const previewImageData = preview.imageData;
                        const prompt = `Evaluate how well this image matches the following design need: ${normalizedRequirement}

Return JSON only:
{
  "score": 0-100,
  "reason": "Short explanation",
  "suggestedUse": "How this image could be used in the design"
}`;

                        // 候选循环本身串行，这里过并发闸门是为了与 analyzeAssetContent 共享同一个视觉调用上限
                        const response = await this.runWithVisionCallGate(() => visionModelCall(
                            `data:image/jpeg;base64,${previewImageData}`,
                            prompt
                        ));
                        const parsed = this.parseJsonObject<{
                            score?: number;
                            reason?: string;
                            suggestedUse?: string;
                        }>(response);

                        if (parsed) {
                            modelScore = this.clampScore(Number(parsed.score || 0));
                            modelReason = String(parsed.reason || '').trim();
                            suggestedUse = String(parsed.suggestedUse || '').trim();
                        }
                    }
                } catch {
                    console.warn(`[ResourceManager] Vision re-rank failed for: ${candidate.file.path}`);
                }

                const finalScore = modelScore === undefined
                    ? candidate.heuristicScore
                    : this.clampScore(candidate.heuristicScore * 0.55 + modelScore * 0.45);
                const finalReason = modelReason
                    ? `${modelReason} | heuristic: ${candidate.heuristicReason}`
                    : `heuristic: ${candidate.heuristicReason}`;

                recommendations.push({
                    file: candidate.file,
                    matchScore: finalScore,
                    matchReason: finalReason,
                    suggestedUse: suggestedUse || 'Use as a candidate image for the current design requirement'
                });
            }

            for (const candidate of heuristicRanked.slice(visionCandidates.length)) {
                recommendations.push({
                    file: candidate.file,
                    matchScore: candidate.heuristicScore,
                    matchReason: `heuristic: ${candidate.heuristicReason}`,
                    suggestedUse: 'Use as a backup candidate'
                });
            }

            recommendations.sort((a, b) => {
                if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
                if (deterministic) {
                    return String(a.file.path || '').localeCompare(String(b.file.path || ''));
                }
                return 0;
            });
            return {
                success: true,
                recommendations: recommendations.slice(0, maxResults)
            };
        } catch (e) {
            return {
                success: false,
                error: `Asset recommendation failed: ${e instanceof Error ? e.message : e}`
            };
        }
    }

    async getAssetDetails(imagePath: string): Promise<{
        success: boolean;
        details?: {
            path: string;
            name: string;
            dimensions: { width: number; height: number };
            size: number;
            format: string;
            preview: string;  // base64 缩略图
        };
        error?: string;
    }> {
        try {
            if (!fs.existsSync(imagePath)) {
                return { success: false, error: '文件不存在' };
            }

            const stats = fs.statSync(imagePath);
            const ext = path.extname(imagePath).toLowerCase();
            const metadata = await sharp(imagePath).metadata();
            const thumbnail = await this.generateThumbnail(imagePath, 200);

            return {
                success: true,
                details: {
                    path: imagePath,
                    name: path.basename(imagePath),
                    dimensions: {
                        width: metadata.width || 0,
                        height: metadata.height || 0
                    },
                    size: stats.size,
                    format: ext.slice(1),
                    preview: thumbnail || ''
                }
            };
        } catch (e) {
            return {
                success: false,
                error: `获取详情失败: ${e instanceof Error ? e.message : e}`
            };
        }
    }
}

export default ResourceManagerService;
