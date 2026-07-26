import { Tool, ToolSchema } from '../types';
import { saveActiveDocumentWithJsx, saveDocumentViaJsx } from '../../core/jsx-bridge';
import { getEntryFromPath } from '../../core/file-url';
import { createToolFailureResult } from '../../core/tool-error-normalizer';
import {
    readActiveHistoryStateRef,
    sameHistoryStateRef,
    type PhotoshopHistoryStateRef
} from '../../core/photoshop-history-state-ref';

const app = require('photoshop').app;
const { core, action } = require('photoshop');
const uxpFs = require('uxp').storage.localFileSystem;

type SaveParams = {
    format?: string;
    path?: string;
    quality?: number;
    saveAs?: boolean;
};

function detectFormat(format?: string, filePath?: string): string {
    const explicit = String(format || '').trim().toLowerCase();
    if (explicit) return explicit;

    const ext = ((String(filePath || '').match(/\.([a-z0-9]+)$/i) || [])[1] || '').toLowerCase();
    if (ext === 'psb') return 'psb';
    if (ext === 'psd') return 'psd';
    if (ext === 'png') return 'png';
    if (ext === 'jpg' || ext === 'jpeg') return 'jpg';
    if (ext === 'tif' || ext === 'tiff') return 'tiff';
    if (ext === 'pdf') return 'pdf';
    return 'psd';
}

async function createSaveToken(filePath: string): Promise<string> {
    const normalizedPath = String(filePath || '').trim();
    if (!normalizedPath) {
        throw new Error('Missing save path');
    }

    try {
        const existingEntry = await getEntryFromPath(uxpFs, normalizedPath) as any;
        if (existingEntry) {
            if (existingEntry.isFolder === true) {
                throw new Error(`Save target is a folder, not a file: ${normalizedPath}`);
            }
            return await uxpFs.createSessionToken(existingEntry);
        }
    } catch (error: any) {
        if (/folder, not a file/i.test(String(error?.message || error))) {
            throw error;
        }
    }

    const slashIndex = Math.max(normalizedPath.lastIndexOf('\\'), normalizedPath.lastIndexOf('/'));
    const directoryPath = slashIndex >= 0 ? normalizedPath.slice(0, slashIndex) : '';
    const fileName = slashIndex >= 0 ? normalizedPath.slice(slashIndex + 1) : normalizedPath;

    if (!directoryPath || !fileName) {
        throw new Error(`Invalid save path: ${normalizedPath}`);
    }

    const directoryEntry = await getEntryFromPath(uxpFs, directoryPath) as any;
    const fileEntry = await directoryEntry.createFile(fileName, { overwrite: true });
    return await uxpFs.createSessionToken(fileEntry);
}

function getSaveDescriptor(format: string, quality?: number): any {
    const normalized = detectFormat(format);
    switch (normalized) {
        case 'psd':
            return {
                _obj: 'photoshop35Format',
                maximizeCompatibility: true
            };
        case 'psb':
            return {
                _obj: 'largeDocumentFormat',
                maximizeCompatibility: true
            };
        case 'png':
            return {
                _obj: 'PNGFormat',
                PNGInterlaceType: { _enum: 'PNGInterlaceType', _value: 'PNGInterlaceNone' },
                compression: 6
            };
        case 'jpeg':
        case 'jpg':
            return {
                _obj: 'JPEG',
                quality: quality || 80
            };
        case 'tif':
        case 'tiff':
            return {
                _obj: 'TIFF',
                byteOrder: { _enum: 'platform', _value: 'IBMPC' },
                LZWCompression: true
            };
        case 'pdf':
            return {
                _obj: 'photoshopPDFFormat',
                pDFPresetFilename: 'High Quality Print',
                preserveEditing: true
            };
        default:
            throw new Error(`Unsupported save format: ${format}`);
    }
}

function toDocumentPixels(value: any): number {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    try {
        if (typeof value?.as === 'function') {
            const px = Number(value.as('px'));
            if (Number.isFinite(px)) return px;
        }
    } catch {
        // ignore and fall back
    }
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
        return numeric;
    }
    throw new Error('Unable to read document pixel size');
}

function toJsxJpegQuality(quality: unknown, fallback = 80): number {
    const raw = Number(quality);
    const normalized = Number.isFinite(raw) ? Math.max(1, Math.min(100, Math.round(raw))) : fallback;
    return Math.max(1, Math.min(12, Math.round(normalized / 100 * 12)));
}

function getRasterExportExtension(filePath: string): string {
    const ext = ((String(filePath || '').match(/\.([a-z0-9]+)$/i) || [])[1] || '').toLowerCase();
    if (ext === 'png') return 'png';
    if (ext === 'jpg' || ext === 'jpeg') return 'jpg';
    return '';
}

function normalizeRasterExportFormat(format: unknown, outputPath?: string): 'png' | 'jpg' {
    const pathFormat = getRasterExportExtension(String(outputPath || ''));
    if (pathFormat) return pathFormat as 'png' | 'jpg';
    const normalized = String(format || '').trim().toLowerCase();
    return normalized === 'jpg' || normalized === 'jpeg' ? 'jpg' : 'png';
}

function appendSuffixBeforeExtension(filePath: string, suffix: string): string {
    const cleanSuffix = String(suffix || '').trim();
    if (!cleanSuffix) return filePath;
    return String(filePath || '').replace(/(\.[a-z0-9]+)$/i, `${cleanSuffix}$1`);
}

async function batchPlaySave(descriptor: any, options: { token?: string; dialog?: 'dontDisplay' }) {
    const command: any = {
        _obj: 'save',
        as: descriptor,
        _options: { dialogOptions: options.dialog }
    };
    if (options.token) {
        command.in = { _kind: 'local', _path: options.token };
        command.lowerCase = true;
        command.saveStage = { _enum: 'saveStageType', _value: 'saveBegin' };
    }
    await action.batchPlay([command], { synchronousExecution: true });
}

export class SaveDocumentTool implements Tool {
    name = 'saveDocument';

    schema: ToolSchema = {
        name: 'saveDocument',
        description: 'Save the active document as PSD, PSB, or another export format. Supports deterministic save-as when path is provided.',
        parameters: {
            type: 'object',
            properties: {
                format: {
                    type: 'string',
                    enum: ['psd', 'psb', 'png', 'jpeg', 'jpg', 'tiff', 'pdf'],
                    description: 'Save format. If omitted, format is inferred from path or defaults to psd.'
                },
                path: {
                    type: 'string',
                    description: 'Absolute output path. When provided, the document is saved silently to this path.'
                },
                quality: {
                    type: 'number',
                    description: 'JPEG quality (1-100).'
                },
                saveAs: {
                    type: 'boolean',
                    description: 'Deprecated for Agent execution. Provide path for deterministic Save As; no-path dialog save is refused.'
                }
            }
        }
    };

    async execute(params: SaveParams): Promise<{
        success: boolean;
        savedPath?: string;
        format?: string;
        sourceHistoryStateRef?: PhotoshopHistoryStateRef;
        error?: string;
    }> {
        try {
            const doc = app.activeDocument;
            if (!doc) {
                return createToolFailureResult({
                    toolName: this.name,
                    error: new Error('No active document'),
                    params
                });
            }

            const requestedPath = String(params.path || '').trim();
            const format = detectFormat(params.format, requestedPath);

            if (requestedPath && (format === 'png' || format === 'jpg' || format === 'jpeg')) {
                const jsxFormat = format === 'png' ? 'png' : 'jpg';
                const jsxResult = await saveDocumentViaJsx(requestedPath, jsxFormat, doc.name, {
                    jpegQuality: toJsxJpegQuality(params.quality)
                });
                return {
                    success: true,
                    savedPath: jsxResult.filePath,
                    format: jsxFormat,
                    sourceHistoryStateRef: jsxResult.sourceHistoryStateRef
                };
            }

            const descriptor = getSaveDescriptor(format, params.quality);
            let sourceHistoryStateRef: PhotoshopHistoryStateRef | undefined;

            await core.executeAsModal(async () => {
                const modalDocument = app.activeDocument;
                if (!modalDocument || Number(modalDocument.id) !== Number(doc.id)) {
                    throw new Error('Active document changed before save commit');
                }
                sourceHistoryStateRef = readActiveHistoryStateRef(modalDocument);
                if (requestedPath) {
                    const token = await createSaveToken(requestedPath);
                    await batchPlaySave(descriptor, { token, dialog: 'dontDisplay' });
                    return;
                }

                const hasSavedPath = (doc as any).saved;
                if ((format === 'psd' || format === 'psb') && !params.saveAs && hasSavedPath && format === 'psd') {
                    await action.batchPlay([
                        {
                            _obj: 'save',
                            _options: { dialogOptions: 'dontDisplay' }
                        }
                    ], { synchronousExecution: true });
                    return;
                }

                throw new Error('saveDocument requires path when the current document cannot be saved silently; refusing to open Photoshop save dialog.');
            }, { commandName: `DesignEcho: Save Document (${format.toUpperCase()})` });

            return {
                success: true,
                savedPath: requestedPath || doc.name,
                format,
                sourceHistoryStateRef
            };
        } catch (error) {
            console.error('[SaveDocument] Error:', error);

            const requestedPath = String(params.path || '').trim();
            const format = detectFormat(params.format, requestedPath);
            if (requestedPath && (format === 'psd' || format === 'psb')) {
                try {
                    const jsxResult = await saveActiveDocumentWithJsx(requestedPath, format as 'psd' | 'psb');
                    return {
                        success: true,
                        savedPath: jsxResult.filePath,
                        format,
                        sourceHistoryStateRef: jsxResult.sourceHistoryStateRef
                    };
                } catch (jsxError) {
                    console.warn('[SaveDocument] JSX fallback failed:', jsxError);
                }
            }

            return createToolFailureResult({
                toolName: this.name,
                error,
                params
            });
        }
    }
}

export class QuickExportTool implements Tool {
    name = 'quickExport';

    schema: ToolSchema = {
        name: 'quickExport',
        description: 'Quick export the active document or selected layers as PNG/JPEG.',
        parameters: {
            type: 'object',
            properties: {
                format: {
                    type: 'string',
                    enum: ['png', 'jpeg', 'jpg'],
                    description: 'Export format.'
                },
                scale: {
                    type: 'number',
                    description: 'Scale ratio (0.1-4).'
                },
                quality: {
                    type: 'number',
                    description: 'JPEG quality (1-100).'
                },
                exportLayers: {
                    type: 'boolean',
                    description: 'Export selected layers instead of the full document.'
                },
                outputPath: {
                    type: 'string',
                    description: 'Absolute output directory or complete PNG/JPEG file path. Required for silent Agent export.'
                },
                suffix: {
                    type: 'string',
                    description: 'Optional filename suffix.'
                }
            }
        }
    };

    async execute(params: {
        format?: string;
        scale?: number;
        quality?: number;
        exportLayers?: boolean;
        suffix?: string;
        outputPath?: string;
    }): Promise<{
        success: boolean;
        exportedFiles?: string[];
        outputPath?: string;
        /** 导出成功时的最终文件绝对路径（含自动生成的文件名/后缀），与 exportedFiles[0] 一致 */
        filePath?: string;
        /** 实际使用的导出格式（png/jpg，经 normalizeRasterExportFormat 归一） */
        format?: 'png' | 'jpg';
        sourceHistoryStateRef?: PhotoshopHistoryStateRef;
        error?: string;
    }> {
        try {
            const doc = app.activeDocument;
            if (!doc) {
                return createToolFailureResult({
                    toolName: this.name,
                    error: new Error('No active document'),
                    params
                });
            }

            const quality = params.quality || 80;
            const suffix = params.suffix || '';
            const outputPath = String(params.outputPath || '').trim();
            const format = normalizeRasterExportFormat(params.format, outputPath);
            const scale = Number(params.scale || 1);

            if (params.exportLayers) {
                return createToolFailureResult({
                    toolName: this.name,
                    error: new Error('quickExport exportLayers is not supported in silent Agent export; use a layer-specific export tool with an explicit output path.'),
                    params
                });
            }

            if (Number.isFinite(scale) && scale !== 1) {
                return createToolFailureResult({
                    toolName: this.name,
                    error: new Error('quickExport scale is not supported by the silent export path; use batchExport presets for resized outputs.'),
                    params
                });
            }

            if (!outputPath) {
                return createToolFailureResult({
                    toolName: this.name,
                    error: new Error('quickExport requires outputPath for silent export; refusing to open Photoshop export dialog.'),
                    params
                });
            }

            const exported = await this.exportToPath(doc, outputPath, format, quality, suffix);

            return {
                success: true,
                exportedFiles: [exported.filePath],
                outputPath: outputPath || undefined,
                filePath: exported.filePath,
                format,
                sourceHistoryStateRef: exported.sourceHistoryStateRef
            };
        } catch (error) {
            console.error('[QuickExport] Error:', error);
            return createToolFailureResult({
                toolName: this.name,
                error,
                params
            });
        }
    }

    private async exportToPath(
        doc: any,
        outputPath: string,
        format: string,
        quality: number,
        suffix: string
    ): Promise<{ filePath: string; sourceHistoryStateRef?: PhotoshopHistoryStateRef }> {
        const explicitFileFormat = getRasterExportExtension(outputPath);
        if (explicitFileFormat) {
            const filePath = appendSuffixBeforeExtension(outputPath, suffix);
            const jsxResult = await saveDocumentViaJsx(filePath, explicitFileFormat === 'png' ? 'png' : 'jpg', doc.name, {
                jpegQuality: this.toJsxJpegQuality(quality)
            });
            return {
                filePath,
                sourceHistoryStateRef: jsxResult.sourceHistoryStateRef
            };
        }

        const docName = doc.name?.replace(/\.[^.]+$/, '') || 'export';
        const ext = format === 'png' ? '.png' : '.jpg';
        const fileName = `${docName}${suffix}${ext}`;
        const filePath = `${outputPath.replace(/[\\/]+$/, '')}\\${fileName}`;
        const jsxResult = await saveDocumentViaJsx(filePath, format === 'png' ? 'png' : 'jpg', doc.name, {
            jpegQuality: this.toJsxJpegQuality(quality)
        });
        return {
            filePath,
            sourceHistoryStateRef: jsxResult.sourceHistoryStateRef
        };
    }

    private toJsxJpegQuality(quality: number): number {
        const normalized = Number.isFinite(quality) ? Math.max(1, Math.min(100, Math.round(quality))) : 80;
        return Math.max(1, Math.min(12, Math.round(normalized / 100 * 12)));
    }
}

export class BatchExportTool implements Tool {
    name = 'batchExport';

    schema: ToolSchema = {
        name: 'batchExport',
        description: 'Batch export multiple sizes for e-commerce deliverables.',
        parameters: {
            type: 'object',
            properties: {
                presets: {
                    type: 'array',
                    description: 'Export presets with width, height, and suffix.'
                },
                format: {
                    type: 'string',
                    enum: ['png', 'jpeg', 'jpg'],
                    description: 'Export format.'
                },
                quality: {
                    type: 'number',
                    description: 'JPEG quality (1-100).'
                },
                outputDirectory: {
                    type: 'string',
                    description: 'Absolute output directory for silent batch export.'
                }
            },
            required: ['outputDirectory']
        }
    };

    async execute(params: {
        presets?: Array<{ width: number; height: number; suffix: string }>;
        format?: string;
        quality?: number;
        outputDirectory?: string;
    }): Promise<any> {
        try {
            const doc = app.activeDocument;
            if (!doc) {
                return createToolFailureResult({
                    toolName: this.name,
                    error: new Error('No active document'),
                    params
                });
            }

            const outputDirectory = String(params.outputDirectory || '').trim();
            if (!outputDirectory) {
                return createToolFailureResult({
                    toolName: this.name,
                    error: new Error('batchExport requires outputDirectory'),
                    params
                });
            }

            const presets = params.presets || [
                { width: 800, height: 800, suffix: '_main' },
                { width: 400, height: 400, suffix: '_sku' },
                { width: 750, height: 0, suffix: '_detail' }
            ];
            const format = String(params.format || 'jpeg').toLowerCase();
            const quality = params.quality || 85;
            if (!Array.isArray(presets) || presets.length === 0) {
                return { success: false, error: 'batchExport requires at least one preset' };
            }

            const normalizedPresets = presets.map((preset, index) => {
                const width = Number(preset?.width || 0);
                const height = Number(preset?.height || 0);
                const suffix = String(preset?.suffix || '').trim();
                if ((!Number.isFinite(width) || width < 0) || (!Number.isFinite(height) || height < 0)) {
                    throw new Error(`Invalid preset dimensions at index ${index}`);
                }
                if (width <= 0 && height <= 0) {
                    throw new Error(`Preset at index ${index} must define width or height greater than 0`);
                }
                if (!suffix) {
                    throw new Error(`Preset at index ${index} requires a non-empty suffix`);
                }
                return { width, height, suffix };
            });

            const ext = format === 'png' ? 'png' : 'jpg';
            const docName = String(doc.name || 'export').replace(/\.[^.]+$/, '');
            const exportedFiles: Array<{
                filePath: string;
                width: number;
                height: number;
                suffix: string;
            }> = [];
            let sourceHistoryStateRef: PhotoshopHistoryStateRef | undefined;
            let sourceHistoryStateConsistent = true;

            for (const preset of normalizedPresets) {
                const resolved = this.resolvePresetDimensions(doc, preset);
                const filePath = `${outputDirectory.replace(/[\\/]+$/, '')}\\${docName}${preset.suffix}.${ext}`;
                const jsxResult = await saveDocumentViaJsx(filePath, ext === 'png' ? 'png' : 'jpg', doc.name, {
                    width: resolved.width,
                    height: resolved.height,
                    jpegQuality: this.toJsxJpegQuality(quality)
                });
                const candidateRef = jsxResult.sourceHistoryStateRef;
                if (!candidateRef
                    || candidateRef.documentId !== Number(doc.id)
                    || (sourceHistoryStateRef && !sameHistoryStateRef(sourceHistoryStateRef, candidateRef))) {
                    sourceHistoryStateConsistent = false;
                } else if (!sourceHistoryStateRef) {
                    sourceHistoryStateRef = candidateRef;
                }
                exportedFiles.push({
                    filePath,
                    width: resolved.width,
                    height: resolved.height,
                    suffix: preset.suffix
                });
            }

            return {
                success: true,
                entityType: 'export-batch',
                documentId: Number(doc.id),
                name: doc.name,
                outputDirectory,
                format: ext,
                exportedCount: exportedFiles.length,
                exportedFiles,
                sourceHistoryStateRef: sourceHistoryStateConsistent ? sourceHistoryStateRef : undefined,
                sourceHistoryStateVerified: sourceHistoryStateConsistent && Boolean(sourceHistoryStateRef),
                message: `Exported ${exportedFiles.length} files to ${outputDirectory}`,
                exported: exportedFiles.length
            };
        } catch (error) {
            console.error('[BatchExport] Error:', error);
            return createToolFailureResult({
                toolName: this.name,
                error,
                params
            });
        }
    }

    private resolvePresetDimensions(
        doc: any,
        preset: { width: number; height: number; suffix: string }
    ): { width: number; height: number } {
        const documentWidth = toDocumentPixels(doc.width);
        const documentHeight = toDocumentPixels(doc.height);
        let targetWidth = preset.width;
        let targetHeight = preset.height;

        if (targetHeight === 0) {
            targetHeight = Math.round((targetWidth / documentWidth) * documentHeight);
        } else if (targetWidth === 0) {
            targetWidth = Math.round((targetHeight / documentHeight) * documentWidth);
        }
        return { width: targetWidth, height: targetHeight };
    }

    private toJsxJpegQuality(quality: number): number {
        const normalized = Number.isFinite(quality) ? Math.max(1, Math.min(100, Math.round(quality))) : 85;
        return Math.max(1, Math.min(12, Math.round(normalized / 100 * 12)));
    }
}

export class SmartSaveTool implements Tool {
    name = 'smartSave';

    schema: ToolSchema = {
        name: 'smartSave',
        description: 'Smart save the active document. Saves silently when path exists or is provided.',
        parameters: {
            type: 'object',
            properties: {
                exportFormat: {
                    type: 'string',
                    enum: ['psd', 'psb', 'jpg', 'png'],
                    description: 'Primary save format or additional export format.'
                },
                exportQuality: {
                    type: 'number',
                    description: 'JPEG export quality (1-100).'
                },
                path: {
                    type: 'string',
                    description: 'Absolute output path for deterministic save-as.'
                }
            }
        }
    };

    async execute(params: {
        exportFormat?: string;
        exportQuality?: number;
        path?: string;
    }): Promise<{
        success: boolean;
        message?: string;
        savedPath?: string;
        exportedPath?: string;
        sourceHistoryStateRef?: PhotoshopHistoryStateRef;
        error?: string;
    }> {
        try {
            const doc = app.activeDocument;
            if (!doc) {
                return createToolFailureResult({
                    toolName: this.name,
                    error: new Error('No active document'),
                    params
                });
            }

            const saveFormat = detectFormat(params.exportFormat, params.path);
            let savedPath = '';
            let sourceHistoryStateRef: PhotoshopHistoryStateRef | undefined;

            await core.executeAsModal(async () => {
                const modalDocument = app.activeDocument;
                if (!modalDocument || Number(modalDocument.id) !== Number(doc.id)) {
                    throw new Error('Active document changed before smart save commit');
                }
                sourceHistoryStateRef = readActiveHistoryStateRef(modalDocument);
                if (params.path) {
                    const token = await createSaveToken(params.path);
                    await batchPlaySave(getSaveDescriptor(saveFormat, params.exportQuality), {
                        token,
                        dialog: 'dontDisplay'
                    });
                    savedPath = params.path;
                    return;
                }

                const isSaved = (doc as any).saved !== false;
                if (isSaved && saveFormat === 'psd') {
                    await action.batchPlay([
                        {
                            _obj: 'save',
                            _options: { dialogOptions: 'dontDisplay' }
                        }
                    ], { synchronousExecution: true });
                    savedPath = doc.name;
                    return;
                }

                throw new Error(
                    'smartSave requires path when the current document cannot be saved silently; refusing to open Photoshop save dialog.'
                );
            }, { commandName: 'DesignEcho: Smart Save' });

            let exportedPath = '';
            if (params.exportFormat && params.exportFormat !== 'psd' && params.exportFormat !== 'psb') {
                if (!params.path) {
                    return createToolFailureResult({
                        toolName: this.name,
                        error: new Error('smartSave requires path for silent export formats; refusing to open Photoshop export dialog.'),
                        params
                    });
                }

                const exportFormat = params.exportFormat === 'png' ? 'png' : 'jpg';
                const slashIndex = Math.max(params.path.lastIndexOf('\\'), params.path.lastIndexOf('/'));
                const directoryPath = slashIndex >= 0 ? params.path.slice(0, slashIndex) : '';
                const baseName = slashIndex >= 0 ? params.path.slice(slashIndex + 1) : params.path;
                const exportBaseName = baseName.replace(/\.[^.]+$/, '') || doc.name.replace(/\.(psd|psb)$/i, '');
                const exportPath = `${directoryPath}\\${exportBaseName}.${exportFormat}`;
                const exportToken = await createSaveToken(exportPath);

                await core.executeAsModal(async () => {
                    const exportSourceRef = readActiveHistoryStateRef(app.activeDocument);
                    if (!sameHistoryStateRef(sourceHistoryStateRef, exportSourceRef)) {
                        throw new Error('Document version changed between smart save and export');
                    }
                    await action.batchPlay([
                        {
                            _obj: 'save',
                            as: exportFormat === 'png'
                                ? { _obj: 'PNGFormat', method: { _enum: 'PNGMethod', _value: 'quick' } }
                                : {
                                    _obj: 'JPEG',
                                    extendedQuality: params.exportQuality || 85,
                                    matteColor: { _enum: 'matteColor', _value: 'white' }
                                },
                            in: { _kind: 'local', _path: exportToken },
                            lowerCase: true,
                            _options: { dialogOptions: 'dontDisplay' }
                        }
                    ], { synchronousExecution: true });
                    exportedPath = exportPath;
                }, { commandName: `DesignEcho: Export ${String(params.exportFormat).toUpperCase()}` });
            }

            return {
                success: true,
                message: exportedPath
                    ? `Saved: ${savedPath}; Exported: ${exportedPath}`
                    : `Saved: ${savedPath}`,
                savedPath,
                exportedPath: exportedPath || undefined,
                sourceHistoryStateRef
            };
        } catch (error) {
            console.error('[SmartSave] Error:', error);
            return createToolFailureResult({
                toolName: this.name,
                error,
                params
            });
        }
    }
}
