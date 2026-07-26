import { openDocumentWithJsx, runJsxCode } from '../../core/jsx-bridge';
import { createToolFailureResult } from '../../core/tool-error-normalizer';
import { Tool, ToolResult, ToolSchema } from '../types';

interface ExportWhiteBgFromSkuMaterialParams {
    sourceDocumentPath: string;
    outputPath: string;
    preferredLayerName?: string;
    canvasWidth?: number;
    canvasHeight?: number;
    targetSubjectHeightPx?: number;
    horizontalMarginPx?: number;
    jpegQuality?: number;
}

interface ExportWhiteBgFromSkuMaterialResult {
    success: boolean;
    sourceDocumentPath: string;
    sourceDocumentName: string;
    sourceLayerName: string;
    outputPath: string;
    canvasWidth: number;
    canvasHeight: number;
    targetSubjectHeightPx: number;
    readback: {
        saved: boolean;
        outputPath: string;
        width: number;
        height: number;
    };
}

function cleanString(value: unknown): string {
    return String(value || '').trim();
}

function normalizePositiveInteger(value: unknown, fallback: number, min: number, max: number): number {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(min, Math.min(max, Math.round(numeric)));
}

function normalizeJpegQuality(value: unknown): number {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 12;
    return Math.max(1, Math.min(12, Math.round(numeric)));
}

function escapeForJsxString(value: string): string {
    return String(value || '')
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/\r/g, '\\r')
        .replace(/\n/g, '\\n');
}

function parseJsxNumber(value: unknown): number {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
}

export class ExportWhiteBgFromSkuMaterialTool implements Tool {
    name = 'exportWhiteBgFromSkuMaterial';

    schema: ToolSchema = {
        name: 'exportWhiteBgFromSkuMaterial',
        description: 'Create an ecommerce white-background main image from a project SKU PSD/PSB source and save an exact JPEG output path.',
        parameters: {
            type: 'object',
            properties: {
                sourceDocumentPath: {
                    type: 'string',
                    description: 'Absolute PSD/PSB source path, usually the project SKU document such as D:/Project/PSD/SKU.psb.'
                },
                outputPath: {
                    type: 'string',
                    description: 'Absolute JPEG output path, usually D:/Project/主图/白底.jpg.'
                },
                preferredLayerName: {
                    type: 'string',
                    description: 'Optional SKU color or layer/group name. If omitted, the first visible non-background layer/group is used.'
                },
                canvasWidth: {
                    type: 'number',
                    description: 'White canvas width in pixels. Default 800.'
                },
                canvasHeight: {
                    type: 'number',
                    description: 'White canvas height in pixels. Default 800.'
                },
                targetSubjectHeightPx: {
                    type: 'number',
                    description: 'Target subject height before fitting to horizontal margins. Default 760.'
                },
                horizontalMarginPx: {
                    type: 'number',
                    description: 'Total horizontal margin reserved on the white canvas. Default 40.'
                },
                jpegQuality: {
                    type: 'number',
                    description: 'JPEG quality from 1 to 12 for Photoshop JPEGSaveOptions. Default 12.'
                }
            },
            required: ['sourceDocumentPath', 'outputPath']
        }
    };

    async execute(params: ExportWhiteBgFromSkuMaterialParams): Promise<ToolResult<ExportWhiteBgFromSkuMaterialResult>> {
        try {
            const sourceDocumentPath = cleanString(params.sourceDocumentPath);
            const outputPath = cleanString(params.outputPath);

            if (!sourceDocumentPath) {
                return createToolFailureResult({
                    toolName: this.name,
                    error: new Error('exportWhiteBgFromSkuMaterial requires sourceDocumentPath'),
                    params
                });
            }
            if (!outputPath) {
                return createToolFailureResult({
                    toolName: this.name,
                    error: new Error('exportWhiteBgFromSkuMaterial requires outputPath'),
                    params
                });
            }

            const opened = await openDocumentWithJsx(sourceDocumentPath);
            const canvasWidth = normalizePositiveInteger(params.canvasWidth, 800, 100, 10000);
            const canvasHeight = normalizePositiveInteger(params.canvasHeight, 800, 100, 10000);
            const targetSubjectHeightPx = normalizePositiveInteger(params.targetSubjectHeightPx, 760, 10, canvasHeight);
            const horizontalMarginPx = normalizePositiveInteger(params.horizontalMarginPx, 40, 0, canvasWidth - 1);
            const jpegQuality = normalizeJpegQuality(params.jpegQuality);
            const jsxData = await this.composeAndExport({
                sourceDocumentName: opened.documentName,
                sourceDocumentPath,
                outputPath,
                preferredLayerName: cleanString(params.preferredLayerName),
                canvasWidth,
                canvasHeight,
                targetSubjectHeightPx,
                horizontalMarginPx,
                jpegQuality
            });

            const saved = Boolean(jsxData.saved);
            if (!saved) {
                return createToolFailureResult({
                    toolName: this.name,
                    error: new Error(jsxData.error || 'exportWhiteBgFromSkuMaterial did not save an output file'),
                    params
                });
            }

            return {
                success: true,
                data: {
                    success: true,
                    sourceDocumentPath,
                    sourceDocumentName: cleanString(jsxData.sourceDocumentName) || opened.documentName,
                    sourceLayerName: cleanString(jsxData.sourceLayerName),
                    outputPath: cleanString(jsxData.outputPath) || outputPath,
                    canvasWidth,
                    canvasHeight,
                    targetSubjectHeightPx,
                    readback: {
                        saved,
                        outputPath: cleanString(jsxData.outputPath) || outputPath,
                        width: parseJsxNumber(jsxData.width) || canvasWidth,
                        height: parseJsxNumber(jsxData.height) || canvasHeight
                    }
                }
            };
        } catch (error) {
            return createToolFailureResult({ toolName: this.name, error, params });
        }
    }

    private async composeAndExport(input: {
        sourceDocumentName: string;
        sourceDocumentPath: string;
        outputPath: string;
        preferredLayerName: string;
        canvasWidth: number;
        canvasHeight: number;
        targetSubjectHeightPx: number;
        horizontalMarginPx: number;
        jpegQuality: number;
    }): Promise<any> {
        const jsx = `
var __dePrevDialogs = app.displayDialogs;
app.displayDialogs = DialogModes.NO;
var __deOutput = '';
function __deEncode(value) {
    return encodeURIComponent(String(value === undefined || value === null ? '' : value));
}
function __deResult(fields) {
    var parts = [];
    for (var key in fields) {
        if (!fields.hasOwnProperty(key)) continue;
        if (fields[key] === undefined || fields[key] === null) continue;
        parts.push(__deEncode(key) + '=' + __deEncode(fields[key]));
    }
    __deOutput = '__DESIGNECHO_RESULT__' + parts.join('&');
    return __deOutput;
}

var SOURCE_DOCUMENT_NAME = '${escapeForJsxString(input.sourceDocumentName)}';
var SOURCE_DOCUMENT_PATH = '${escapeForJsxString(input.sourceDocumentPath)}';
var OUTPUT_PATH = '${escapeForJsxString(input.outputPath.replace(/\\/g, '/'))}';
var PREFERRED_LAYER_NAME = '${escapeForJsxString(input.preferredLayerName)}';
var CANVAS_WIDTH = ${input.canvasWidth};
var CANVAS_HEIGHT = ${input.canvasHeight};
var TARGET_SUBJECT_HEIGHT = ${input.targetSubjectHeightPx};
var HORIZONTAL_MARGIN = ${input.horizontalMarginPx};
var JPEG_QUALITY = ${input.jpegQuality};

var sourceDoc = null;
var tempDoc = null;
try {
    function findDocumentByName(name) {
        for (var i = 0; i < app.documents.length; i++) {
            if (String(app.documents[i].name) === String(name)) return app.documents[i];
        }
        return null;
    }

    sourceDoc = findDocumentByName(SOURCE_DOCUMENT_NAME);
    if (!sourceDoc) {
        var sourceFile = new File(SOURCE_DOCUMENT_PATH);
        if (!sourceFile.exists) throw new Error('Source SKU document not found: ' + SOURCE_DOCUMENT_PATH);
        app.open(sourceFile);
        sourceDoc = app.activeDocument;
    }
    app.activeDocument = sourceDoc;

    function asPixels(unitValue) {
        try { return Number(unitValue.as('px')); }
        catch (e) { return Number(unitValue); }
    }

    function readBounds(layer) {
        var result = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
        try {
            result.left = Math.round(asPixels(layer.bounds[0]));
            result.top = Math.round(asPixels(layer.bounds[1]));
            result.right = Math.round(asPixels(layer.bounds[2]));
            result.bottom = Math.round(asPixels(layer.bounds[3]));
            result.width = Math.max(0, result.right - result.left);
            result.height = Math.max(0, result.bottom - result.top);
        } catch (boundsError) {}
        return result;
    }

    function isUsableLayer(layer) {
        if (!layer || layer.visible === false || layer.isBackgroundLayer) return false;
        var bounds = readBounds(layer);
        return bounds.width > 0 && bounds.height > 0;
    }

    function findPreferredLayer(container, preferredName) {
        if (!preferredName || !container || !container.layers) return null;
        for (var i = 0; i < container.layers.length; i++) {
            var layer = container.layers[i];
            if (String(layer.name) === preferredName && isUsableLayer(layer)) return layer;
            if (layer.layers && layer.layers.length) {
                var nested = findPreferredLayer(layer, preferredName);
                if (nested) return nested;
            }
        }
        return null;
    }

    function findFirstVisibleCandidate(container) {
        if (!container || !container.layers) return null;
        for (var i = 0; i < container.layers.length; i++) {
            var layer = container.layers[i];
            if (isUsableLayer(layer)) return layer;
            if (layer.layers && layer.layers.length) {
                var nested = findFirstVisibleCandidate(layer);
                if (nested) return nested;
            }
        }
        return null;
    }

    var sourceLayer = findPreferredLayer(sourceDoc, PREFERRED_LAYER_NAME) || findFirstVisibleCandidate(sourceDoc);
    if (!sourceLayer) {
        throw new Error(PREFERRED_LAYER_NAME
            ? 'Preferred SKU layer not found or has empty bounds: ' + PREFERRED_LAYER_NAME
            : 'No visible SKU layer with usable bounds found in source document');
    }

    tempDoc = app.documents.add(
        UnitValue(CANVAS_WIDTH, 'px'),
        UnitValue(CANVAS_HEIGHT, 'px'),
        72,
        'DesignEcho white background',
        NewDocumentMode.RGB,
        DocumentFill.WHITE
    );

    app.activeDocument = sourceDoc;
    var duplicatedLayer = sourceLayer.duplicate(tempDoc, ElementPlacement.PLACEATBEGINNING);
    app.activeDocument = tempDoc;
    tempDoc.activeLayer = duplicatedLayer;

    var bounds = readBounds(duplicatedLayer);
    if (bounds.width <= 0 || bounds.height <= 0) {
        throw new Error('Duplicated SKU layer has empty bounds: ' + sourceLayer.name);
    }

    var maxSubjectWidth = Math.max(1, CANVAS_WIDTH - HORIZONTAL_MARGIN);
    var scaleByHeight = TARGET_SUBJECT_HEIGHT / bounds.height;
    var scaleByWidth = maxSubjectWidth / bounds.width;
    var scale = Math.min(scaleByHeight, scaleByWidth);
    if (!isFinite(scale) || scale <= 0) scale = 1;
    duplicatedLayer.resize(scale * 100, scale * 100, AnchorPosition.MIDDLECENTER);

    bounds = readBounds(duplicatedLayer);
    var dx = Math.round((CANVAS_WIDTH / 2) - ((bounds.left + bounds.right) / 2));
    var dy = Math.round((CANVAS_HEIGHT / 2) - ((bounds.top + bounds.bottom) / 2));
    duplicatedLayer.translate(UnitValue(dx, 'px'), UnitValue(dy, 'px'));

    var target = new File(OUTPUT_PATH);
    if (!target.parent.exists) {
        target.parent.create();
    }
    var jpegOptions = new JPEGSaveOptions();
    jpegOptions.quality = JPEG_QUALITY;
    jpegOptions.embedColorProfile = true;
    tempDoc.saveAs(target, jpegOptions, true, Extension.LOWERCASE);

    __deResult({
        saved: target.exists ? 1 : 0,
        outputPath: target.fsName,
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
        sourceDocumentName: sourceDoc.name,
        sourceLayerName: sourceLayer.name,
        sourceDocumentPath: SOURCE_DOCUMENT_PATH,
        readback: target.exists ? 'saved' : 'missing'
    });
} catch (error) {
    __deResult({
        saved: 0,
        error: String(error && error.message ? error.message : error),
        outputPath: OUTPUT_PATH,
        sourceDocumentName: sourceDoc ? sourceDoc.name : SOURCE_DOCUMENT_NAME,
        sourceDocumentPath: SOURCE_DOCUMENT_PATH,
        readback: 'failed'
    });
} finally {
    try {
        if (tempDoc) {
            tempDoc.close(SaveOptions.DONOTSAVECHANGES);
        }
    } catch (closeError) {}
    try {
        if (sourceDoc) app.activeDocument = sourceDoc;
    } catch (sourceRestoreError) {}
    try {
        app.displayDialogs = __dePrevDialogs;
    } catch (restoreError) {}
}
__deOutput;
`;

        const result = await runJsxCode(jsx, 'Export white background from SKU material');
        return result.data || {};
    }
}
