/**
 * 设计源文件解析服务（PSD 知识库 P0 · main 侧 IO 壳）
 *
 * ag-psd 离线解析设计师 PSD/PSB（不占 Photoshop、skipLayerImageData 不读像素），
 * 转换为最简树后交给 shared/psd-design-source 纯逻辑提炼 design-source-profile。
 * 只读：绝不修改源文件；P0 不落盘（profile 只作为工具结果返回）。
 */

import * as fs from 'fs';
import * as path from 'path';
import { readPsd } from 'ag-psd';
import {
    validatePsdDesignSourceFile,
    buildPsdDesignSourceProfile,
    type RawDesignSourceNode,
    type PsdDesignSourceProfile
} from '../../shared/psd-design-source';

export interface AnalyzePsdDesignSourceResult {
    success: boolean;
    profile?: PsdDesignSourceProfile;
    error?: string;
}

function toColorHex(color: unknown): string | undefined {
    const record = color as { r?: unknown; g?: unknown; b?: unknown } | undefined;
    if (!record || !Number.isFinite(Number(record.r))) return undefined;
    const channel = (value: unknown): string =>
        Math.max(0, Math.min(255, Math.round(Number(value) || 0))).toString(16).padStart(2, '0');
    return `#${channel(record.r)}${channel(record.g)}${channel(record.b)}`.toUpperCase();
}

function readTextColorHex(text: any): string | undefined {
    const direct = toColorHex(text?.style?.fillColor);
    if (direct) return direct;
    // 分段样式（styleRuns）里的首个填色：整层未设统一色时的常见形态（探针实测缺口）
    const runs = Array.isArray(text?.styleRuns) ? text.styleRuns : [];
    for (const run of runs) {
        const runColor = toColorHex(run?.style?.fillColor);
        if (runColor) return runColor;
    }
    return undefined;
}

function resolveNodeKind(layer: any): RawDesignSourceNode['kind'] {
    if (Array.isArray(layer?.children)) return 'group';
    if (layer?.text) return 'text';
    if (layer?.placedLayer) return 'smartObject';
    if (layer?.vectorMask || layer?.vectorFill || layer?.vectorOrigination) return 'shape';
    if (layer?.adjustment) return 'unknown';
    return 'pixel';
}

function toRawNode(layer: any): RawDesignSourceNode {
    const kind = resolveNodeKind(layer);
    const node: RawDesignSourceNode = {
        name: typeof layer?.name === 'string' ? layer.name : undefined,
        kind,
        left: Number.isFinite(Number(layer?.left)) ? Number(layer.left) : undefined,
        top: Number.isFinite(Number(layer?.top)) ? Number(layer.top) : undefined,
        right: Number.isFinite(Number(layer?.right)) ? Number(layer.right) : undefined,
        bottom: Number.isFinite(Number(layer?.bottom)) ? Number(layer.bottom) : undefined,
        hasEffects: Boolean(layer?.effects && Object.keys(layer.effects).some((key) => key !== 'disabled'))
    };
    if (kind === 'text') {
        node.text = {
            content: typeof layer?.text?.text === 'string' ? layer.text.text : undefined,
            fontName: layer?.text?.style?.font?.name ? String(layer.text.style.font.name) : undefined,
            fontSize: Number.isFinite(Number(layer?.text?.style?.fontSize)) ? Number(layer.text.style.fontSize) : undefined,
            colorHex: readTextColorHex(layer?.text)
        };
    }
    if (kind === 'group') {
        node.children = (layer.children as any[]).map(toRawNode);
    }
    return node;
}

export async function analyzePsdDesignSourceFile(filePath: string): Promise<AnalyzePsdDesignSourceResult> {
    const normalizedPath = String(filePath || '').trim();
    if (!normalizedPath || !fs.existsSync(normalizedPath)) {
        return { success: false, error: `设计源文件不存在：${normalizedPath || '(空路径)'}。请确认完整路径。` };
    }
    const stats = fs.statSync(normalizedPath);
    const validation = validatePsdDesignSourceFile({ filePath: normalizedPath, fileSizeBytes: stats.size });
    if (!validation.ok) {
        return { success: false, error: validation.reason };
    }
    try {
        const startedAt = Date.now();
        const buffer = fs.readFileSync(normalizedPath);
        const psd = readPsd(buffer, {
            skipLayerImageData: true,
            skipCompositeImageData: true,
            skipThumbnail: true
        });
        const parseMs = Date.now() - startedAt;
        const tree = Array.isArray(psd.children) ? psd.children.map(toRawNode) : [];
        const profile = buildPsdDesignSourceProfile({
            fileName: path.basename(normalizedPath),
            format: validation.format,
            fileSizeBytes: stats.size,
            parseMs,
            canvas: { width: Number(psd.width) || 0, height: Number(psd.height) || 0 },
            tree
        });
        return { success: true, profile };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
            success: false,
            error: `解析设计源文件失败：${message}。文件可能损坏或使用了 ag-psd 不支持的特性；可在 Photoshop 中打开后用 getLayerHierarchy 读取结构。`
        };
    }
}
