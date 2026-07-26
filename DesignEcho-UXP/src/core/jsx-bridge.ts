import { action, core } from 'photoshop';
import { storage } from 'uxp';
import { normalizeLocalFilePath } from './file-url';
import type { PhotoshopHistoryStateRef } from './photoshop-history-state-ref';

export interface JsxBridgeResult<T = any> {
    raw: any;
    message: string;
    data: T | null;
}

const JSX_RESULT_PREFIX = '__DESIGNECHO_RESULT__';

function normalizeJsxMessage(message: any): { message: string; data: any | null } {
    const normalized = typeof message === 'string' ? message : String(message ?? '');
    if (!normalized) {
        return { message: '', data: null };
    }

    if (normalized.startsWith(JSX_RESULT_PREFIX)) {
        const payload = normalized.slice(JSX_RESULT_PREFIX.length);
        const data: Record<string, string | boolean> = {};

        for (const part of payload.split('&')) {
            if (!part) continue;
            const separatorIndex = part.indexOf('=');
            const rawKey = separatorIndex >= 0 ? part.slice(0, separatorIndex) : part;
            const rawValue = separatorIndex >= 0 ? part.slice(separatorIndex + 1) : '';
            const key = decodeURIComponent(rawKey);
            const value = decodeURIComponent(rawValue);
            data[key] = key === 'success' ? value === '1' : value;
        }

        return {
            message: normalized,
            data
        };
    }

    try {
        return {
            message: normalized,
            data: JSON.parse(normalized)
        };
    } catch {
        return {
            message: normalized,
            data: null
        };
    }
}

function escapeForJsxString(input: string): string {
    return String(input || '')
        .replace(/\\/g, '/')
        .replace(/'/g, "\\'")
        .replace(/\r/g, '\\r')
        .replace(/\n/g, '\\n');
}

function getJsxBridgePrelude(): string {
    return `
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
    __deOutput = '${JSX_RESULT_PREFIX}' + parts.join('&');
    return __deOutput;
}
`;
}

async function runJsxToken(scriptToken: string, commandName: string): Promise<JsxBridgeResult> {
    let result: any;
    await core.executeAsModal(async () => {
        result = await action.batchPlay([
            {
                _obj: 'AdobeScriptAutomation Scripts',
                javaScript: {
                    _path: scriptToken,
                    _kind: 'local'
                },
                javaScriptMessage: 'undefined',
                _options: {
                    dialogOptions: 'dontDisplay'
                }
            } as any
        ], {
            synchronousExecution: true
        } as any);
    }, { commandName });

    const payload = Array.isArray(result) ? result[0] : result;
    const parsed = normalizeJsxMessage((payload as any)?.javaScriptMessage);
    return {
        raw: payload,
        message: parsed.message,
        data: parsed.data
    };
}

async function getPluginEntryByRelativePath(relativePath: string): Promise<any> {
    const pluginFolder: any = await storage.localFileSystem.getPluginFolder();
    const segments = String(relativePath || '')
        .replace(/[\\/]+/g, '/')
        .split('/')
        .filter(Boolean);

    let currentEntry: any = pluginFolder;
    for (const segment of segments) {
        if (!currentEntry?.getEntry) {
            throw new Error(`Cannot resolve plugin entry: ${relativePath}`);
        }
        currentEntry = await currentEntry.getEntry(segment);
    }

    return currentEntry;
}

export async function runJsxCode(code: string, commandName = 'Run JSX Code'): Promise<JsxBridgeResult> {
    const tempFolder = await storage.localFileSystem.getTemporaryFolder();
    const scriptFile = await tempFolder.createFile(`designecho-${Date.now()}.jsx`, { overwrite: true });

    try {
        await scriptFile.write(code, { format: storage.formats.utf8 });
        const token = await storage.localFileSystem.createSessionToken(scriptFile);
        return await runJsxToken(token, commandName);
    } finally {
        try {
            await scriptFile.delete();
        } catch {
            // Ignore temp cleanup failure.
        }
    }
}

export async function runBundledJsxFile(relativePath: string, commandName = 'Run Bundled JSX'): Promise<JsxBridgeResult> {
    const scriptEntry = await getPluginEntryByRelativePath(relativePath);
    const token = await storage.localFileSystem.createSessionToken(scriptEntry);
    return await runJsxToken(token, commandName);
}

export async function openDocumentWithJsx(filePath: string): Promise<{ success: true; documentName: string; filePath: string }> {
    const normalizedPath = normalizeLocalFilePath(filePath);
    const jsx = `
try {
    ${getJsxBridgePrelude()}
    var target = new File('${escapeForJsxString(normalizedPath)}');
    if (!target.exists) {
        throw new Error('File not found: ' + target.fsName);
    }
    app.open(target);
    __deResult({
        success: 1,
        documentName: app.activeDocument ? app.activeDocument.name : target.name,
        filePath: target.fsName
    });
} catch (error) {
    __deResult({
        success: 0,
        error: String(error && error.message ? error.message : error)
    });
} finally {
    try {
        app.displayDialogs = __dePrevDialogs;
    } catch (restoreError) {}
}
__deOutput;
`;

    const result = await runJsxCode(jsx, 'Open File via JSX');
    if (result.data?.success) {
        return result.data;
    }

    throw new Error(result.data?.error || result.message || `JSX open failed: ${normalizedPath}`);
}

type SaveDocumentViaJsxOptions = {
    jpegQuality?: number;
    maxDimension?: number;
    width?: number;
    height?: number;
};

function getJsxSaveOptions(
    format: 'psd' | 'psb' | 'png' | 'jpg',
    options?: SaveDocumentViaJsxOptions
): { optionCtor: string; setup: string } {
    if (format === 'psb') {
        return {
            optionCtor: 'LargeDocumentFormatOptions',
            setup: 'options.maximizeCompatibility = true;'
        };
    }

    if (format === 'png') {
        return {
            optionCtor: 'PNGSaveOptions',
            setup: ''
        };
    }

    if (format === 'jpg') {
        const jpegQualityRaw = Number(options?.jpegQuality);
        const jpegQuality = Number.isFinite(jpegQualityRaw)
            ? Math.max(0, Math.min(12, Math.round(jpegQualityRaw)))
            : 8;
        return {
            optionCtor: 'JPEGSaveOptions',
            setup: `options.quality = ${jpegQuality}; options.embedColorProfile = true; options.matte = MatteType.NONE;`
        };
    }

    return {
        optionCtor: 'PhotoshopSaveOptions',
        setup: 'options.maximizeCompatibility = true;'
    };
}

export async function saveDocumentViaJsx(
    filePath: string,
    format: 'psd' | 'psb' | 'png' | 'jpg',
    documentName?: string,
    options?: SaveDocumentViaJsxOptions
): Promise<{ success: true; filePath: string; sourceHistoryStateRef?: PhotoshopHistoryStateRef }> {
    const normalizedPath = normalizeLocalFilePath(filePath);
    const { optionCtor, setup } = getJsxSaveOptions(format, options);
    const maxDimensionRaw = Number(options?.maxDimension);
    const maxDimension = Number.isFinite(maxDimensionRaw)
        ? Math.max(0, Math.floor(maxDimensionRaw))
        : 0;
    const widthRaw = Number(options?.width);
    const heightRaw = Number(options?.height);
    const explicitWidth = Number.isFinite(widthRaw) ? Math.max(0, Math.floor(widthRaw)) : 0;
    const explicitHeight = Number.isFinite(heightRaw) ? Math.max(0, Math.floor(heightRaw)) : 0;
    const shouldResizeOnSave =
        explicitWidth > 0 ||
        explicitHeight > 0 ||
        ((format === 'jpg' || format === 'png') && maxDimension > 0);
    const documentLookup = documentName
        ? `
    var targetDoc = null;
    for (var i = 0; i < app.documents.length; i++) {
        if (app.documents[i].name === '${escapeForJsxString(documentName)}') {
            targetDoc = app.documents[i];
            break;
        }
    }
    if (!targetDoc) {
        throw new Error('Document not found: ${escapeForJsxString(documentName)}');
    }
`
        : `
    var targetDoc = app.activeDocument;
`;
    const jsx = `
try {
    ${getJsxBridgePrelude()}
    if (!app.documents.length) {
        throw new Error('No active document');
    }
    var sourceDoc = null;
    var saveDoc = null;
${documentLookup}
    sourceDoc = targetDoc;
    saveDoc = sourceDoc;
    if (${shouldResizeOnSave ? 'true' : 'false'}) {
        var sourceWidth = 0;
        var sourceHeight = 0;
        try {
            sourceWidth = Number(sourceDoc.width.as('px'));
            sourceHeight = Number(sourceDoc.height.as('px'));
        } catch (sizeError) {
            sourceWidth = Number(sourceDoc.width);
            sourceHeight = Number(sourceDoc.height);
        }
        var longestSide = Math.max(sourceWidth || 0, sourceHeight || 0);
        var targetWidth = ${explicitWidth};
        var targetHeight = ${explicitHeight};
        if (targetWidth <= 0 && targetHeight <= 0 && ${maxDimension} > 0 && longestSide > ${maxDimension}) {
            var resizeScale = ${maxDimension} / longestSide;
            targetWidth = Math.max(1, Math.round((sourceWidth || 1) * resizeScale));
            targetHeight = Math.max(1, Math.round((sourceHeight || 1) * resizeScale));
        } else if (targetWidth > 0 && targetHeight <= 0) {
            targetHeight = Math.max(1, Math.round((targetWidth / (sourceWidth || 1)) * (sourceHeight || 1)));
        } else if (targetHeight > 0 && targetWidth <= 0) {
            targetWidth = Math.max(1, Math.round((targetHeight / (sourceHeight || 1)) * (sourceWidth || 1)));
        }
        if (targetWidth > 0 && targetHeight > 0 && (targetWidth !== sourceWidth || targetHeight !== sourceHeight)) {
            saveDoc = sourceDoc.duplicate();
            app.activeDocument = saveDoc;
            saveDoc.resizeImage(
                UnitValue(targetWidth, 'px'),
                UnitValue(targetHeight, 'px'),
                undefined,
                ResampleMethod.BICUBICSHARPER
            );
        }
    }
    var target = new File('${escapeForJsxString(normalizedPath)}');
    if (!target.parent.exists) {
        target.parent.create();
    }
    var options = new ${optionCtor}();
    ${setup}
    saveDoc.saveAs(target, options, true, Extension.LOWERCASE);
    __deResult({
        success: 1,
        filePath: target.fsName,
        documentName: sourceDoc ? sourceDoc.name : '',
        sourceDocumentId: sourceDoc ? sourceDoc.id : '',
        sourceHistoryStateId: sourceDoc && sourceDoc.activeHistoryState ? sourceDoc.activeHistoryState.id : '',
        format: '${format}'
    });
} catch (error) {
    __deResult({
        success: 0,
        error: String(error && error.message ? error.message : error),
        format: '${format}'
    });
} finally {
    try {
        if (saveDoc && sourceDoc && saveDoc !== sourceDoc) {
            saveDoc.close(SaveOptions.DONOTSAVECHANGES);
            app.activeDocument = sourceDoc;
        }
    } catch (cleanupError) {}
    try {
        app.displayDialogs = __dePrevDialogs;
    } catch (restoreError) {}
}
__deOutput;
`;

    const result = await runJsxCode(jsx, 'Save Document via JSX');
    if (result.data?.success) {
        const documentId = Number(result.data.sourceDocumentId);
        const historyStateId = Number(result.data.sourceHistoryStateId);
        const sourceHistoryStateRef = Number.isSafeInteger(documentId)
            && documentId > 0
            && Number.isSafeInteger(historyStateId)
            && historyStateId > 0
            ? { documentId, historyStateId }
            : undefined;
        return {
            ...result.data,
            ...(sourceHistoryStateRef ? { sourceHistoryStateRef } : {})
        };
    }

    throw new Error(result.data?.error || result.message || `JSX save failed: ${normalizedPath}`);
}

export async function saveActiveDocumentWithJsx(
    filePath: string,
    format: 'psd' | 'psb'
): Promise<{ success: true; filePath: string; sourceHistoryStateRef?: PhotoshopHistoryStateRef }> {
    return await saveDocumentViaJsx(filePath, format);
}

export async function exportActiveSelectionAsDesignAssetWithJsx(params: {
    fileBasePath: string;
    previewFilePath?: string;
    expectedSelectionCount?: number;
    assetName?: string;
    previewMaxDimension?: number;
    jpegQuality?: number;
}): Promise<{
    filePath: string;
    previewFilePath?: string;
    format: 'psd' | 'psb';
    width: number;
    height: number;
    selectionCount: number;
    sourceDocumentName: string;
    tempDocumentName: string;
    smartObjectDocumentName: string;
}> {
    const normalizedBasePath = normalizeLocalFilePath(params.fileBasePath);
    const normalizedPreviewPath = params.previewFilePath
        ? normalizeLocalFilePath(params.previewFilePath)
        : '';
    const expectedSelectionCountRaw = Number(params.expectedSelectionCount);
    const expectedSelectionCount = Number.isFinite(expectedSelectionCountRaw)
        ? Math.max(1, Math.floor(expectedSelectionCountRaw))
        : 1;
    const previewMaxDimensionRaw = Number(params.previewMaxDimension);
    const previewMaxDimension = Number.isFinite(previewMaxDimensionRaw)
        ? Math.max(0, Math.floor(previewMaxDimensionRaw))
        : 0;
    const jpegQualityRaw = Number(params.jpegQuality);
    const jpegQuality = Number.isFinite(jpegQualityRaw)
        ? Math.max(0, Math.min(12, Math.round(jpegQualityRaw)))
        : 8;
    const assetName = String(params.assetName || 'Design Asset').trim() || 'Design Asset';
    const tempDocumentName = `${assetName.slice(0, 48) || 'DesignEcho'}_${Date.now()}`;
    const previewDuplicateName = `${assetName.slice(0, 40) || 'DesignEcho'}_Preview`;

    const jsx = `
var sourceDoc = null;
var tempDoc = null;
var smartDoc = null;
try {
    ${getJsxBridgePrelude()}
    function __deGetSelectedLayerCount() {
        if (!app.documents.length || !app.activeDocument) {
            return 0;
        }
        try {
            var ref = new ActionReference();
            ref.putProperty(stringIDToTypeID('property'), stringIDToTypeID('targetLayers'));
            ref.putEnumerated(charIDToTypeID('Dcmn'), charIDToTypeID('Ordn'), charIDToTypeID('Trgt'));
            var desc = executeActionGet(ref);
            if (desc.hasKey(stringIDToTypeID('targetLayers'))) {
                return desc.getList(stringIDToTypeID('targetLayers')).count;
            }
        } catch (selectionError) {}
        try {
            return app.activeDocument.activeLayer ? 1 : 0;
        } catch (activeLayerError) {
            return 0;
        }
    }
    function __deAsPixels(value) {
        try {
            return Number(value.as('px'));
        } catch (unitError) {
            return Number(value);
        }
    }
    function __deSaveDesignFile(doc, fileBasePath) {
        var width = Math.max(1, Math.round(__deAsPixels(doc.width) || 1));
        var height = Math.max(1, Math.round(__deAsPixels(doc.height) || 1));
        var format = (width > 30000 || height > 30000) ? 'psb' : 'psd';
        var target = new File(fileBasePath + '.' + format);
        if (!target.parent.exists) {
            target.parent.create();
        }
        var options = format === 'psb'
            ? new LargeDocumentFormatOptions()
            : new PhotoshopSaveOptions();
        options.maximizeCompatibility = true;
        doc.saveAs(target, options, true, Extension.LOWERCASE);
        return {
            filePath: target.fsName,
            format: format,
            width: width,
            height: height
        };
    }
    function __deSavePreview(doc, filePath, maxDimension, quality) {
        var originalDoc = app.activeDocument;
        var previewDoc = doc;
        var shouldClosePreviewDoc = false;
        try {
            var width = Math.max(1, __deAsPixels(doc.width) || 1);
            var height = Math.max(1, __deAsPixels(doc.height) || 1);
            var longestSide = Math.max(width, height);
            if (maxDimension > 0 && longestSide > maxDimension) {
                var scale = maxDimension / longestSide;
                var targetWidth = Math.max(1, Math.round(width * scale));
                var targetHeight = Math.max(1, Math.round(height * scale));
                previewDoc = doc.duplicate('${escapeForJsxString(previewDuplicateName)}', false);
                shouldClosePreviewDoc = true;
                app.activeDocument = previewDoc;
                previewDoc.resizeImage(
                    UnitValue(targetWidth, 'px'),
                    UnitValue(targetHeight, 'px'),
                    undefined,
                    ResampleMethod.BICUBICSHARPER
                );
            } else {
                app.activeDocument = previewDoc;
            }
            var target = new File(filePath);
            if (!target.parent.exists) {
                target.parent.create();
            }
            var options = new JPEGSaveOptions();
            options.quality = quality;
            options.embedColorProfile = true;
            options.matte = MatteType.NONE;
            previewDoc.saveAs(target, options, true, Extension.LOWERCASE);
            return target.fsName;
        } finally {
            try {
                if (shouldClosePreviewDoc && previewDoc) {
                    previewDoc.close(SaveOptions.DONOTSAVECHANGES);
                }
            } catch (previewCleanupError) {}
            try {
                if (doc) {
                    app.activeDocument = doc;
                } else if (originalDoc) {
                    app.activeDocument = originalDoc;
                }
            } catch (previewRestoreError) {}
        }
    }
    if (!app.documents.length || !app.activeDocument) {
        throw new Error('No active document');
    }
    sourceDoc = app.activeDocument;
    var sourceSelectionCount = __deGetSelectedLayerCount();
    if (sourceSelectionCount < 1) {
        throw new Error('No selected layers available for export.');
    }
    if (sourceSelectionCount !== ${expectedSelectionCount}) {
        throw new Error('Selection changed before export started.');
    }
    tempDoc = sourceDoc.duplicate('${escapeForJsxString(tempDocumentName)}', false);
    app.activeDocument = tempDoc;
    var duplicatedSelectionCount = __deGetSelectedLayerCount();
    if (duplicatedSelectionCount !== ${expectedSelectionCount}) {
        throw new Error('Duplicated document did not preserve the selected layers.');
    }
    executeAction(stringIDToTypeID('newPlacedLayer'), undefined, DialogModes.NO);
    executeAction(stringIDToTypeID('placedLayerEditContents'), undefined, DialogModes.NO);
    smartDoc = app.activeDocument;
    if (!smartDoc) {
        throw new Error('Failed to open smart object contents.');
    }
    var saved = __deSaveDesignFile(smartDoc, '${escapeForJsxString(normalizedBasePath)}');
    var savedPreviewPath = '';
    if ('${escapeForJsxString(normalizedPreviewPath)}') {
        savedPreviewPath = __deSavePreview(smartDoc, '${escapeForJsxString(normalizedPreviewPath)}', ${previewMaxDimension}, ${jpegQuality});
    }
    __deResult({
        success: 1,
        filePath: saved.filePath,
        previewFilePath: savedPreviewPath,
        format: saved.format,
        width: saved.width,
        height: saved.height,
        selectionCount: duplicatedSelectionCount,
        sourceDocumentName: sourceDoc ? sourceDoc.name : '',
        tempDocumentName: tempDoc ? tempDoc.name : '',
        smartObjectDocumentName: smartDoc ? smartDoc.name : ''
    });
} catch (error) {
    __deResult({
        success: 0,
        error: String(error && error.message ? error.message : error)
    });
} finally {
    try {
        if (smartDoc) {
            app.activeDocument = smartDoc;
            smartDoc.close(SaveOptions.DONOTSAVECHANGES);
        }
    } catch (smartCleanupError) {}
    try {
        if (tempDoc) {
            app.activeDocument = tempDoc;
            tempDoc.close(SaveOptions.DONOTSAVECHANGES);
        }
    } catch (tempCleanupError) {}
    try {
        if (sourceDoc) {
            app.activeDocument = sourceDoc;
        }
    } catch (sourceRestoreError) {}
    try {
        app.displayDialogs = __dePrevDialogs;
    } catch (restoreError) {}
}
__deOutput;
`;

    const result = await runJsxCode(jsx, 'Export Selection as Design Asset');
    if (result.data?.success) {
        return {
            filePath: String(result.data.filePath || '').trim(),
            previewFilePath: String(result.data.previewFilePath || '').trim() || undefined,
            format: String(result.data.format || 'psd').trim().toLowerCase() === 'psb' ? 'psb' : 'psd',
            width: Math.max(1, Math.round(Number(result.data.width || 1))),
            height: Math.max(1, Math.round(Number(result.data.height || 1))),
            selectionCount: Math.max(1, Math.round(Number(result.data.selectionCount || expectedSelectionCount))),
            sourceDocumentName: String(result.data.sourceDocumentName || '').trim(),
            tempDocumentName: String(result.data.tempDocumentName || '').trim(),
            smartObjectDocumentName: String(result.data.smartObjectDocumentName || '').trim()
        };
    }

    throw new Error(result.data?.error || result.message || 'JSX export selection failed');
}

export async function saveNamedDocumentWithJsx(
    documentName: string,
    filePath: string,
    format: 'psd' | 'psb' | 'png' | 'jpg',
    options?: SaveDocumentViaJsxOptions
): Promise<{ success: true; filePath: string }> {
    return await saveDocumentViaJsx(filePath, format, documentName, options);
}
