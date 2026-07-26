/**
 * 主图/详情页批量导出工具（用户导出规范 4.0 移植，2026-07-07）
 *
 * ground truth：用户脚本「4.0主图导出所有主图文档.jsx」——语义逐条保真移植：
 * - 按名匹配已打开文档 800/750/1200/详情页（去扩展名）；未打开记 notFound 不中断
 * - 目录结构：<导出目录>/主图/800、/主图/750、/主图/1200；详情页切片导出到 <导出目录>
 * - 主图文档：隐藏全部顶层 → 逐个处理「转化图」「点击图」父组 → 其下每个非空子组
 *   单独显示并导出 JPEG（文件名=子组名，非法字符清理）
 * - JPEG 质量自适应：从 12 起，文件 >maxFileSizeMB(默认3MB) 逐级降质，最低 10
 * - 详情页：Save For Web 导出全部切片（JPEG quality 100 optimized）
 * - 每个文档处理后恢复历史状态（不污染文档）；四态报告 success/failure/skipped/notFound
 *
 * 通过 jsx-bridge 执行（ExtendScript 保真），交互点替换：选目录对话框→outputDir 参数、
 * alert 报告→结构化返回。
 */

import { runJsxCode } from '../../core/jsx-bridge';
import { createToolFailureResult } from '../../core/tool-error-normalizer';
import { Tool, ToolResult, ToolSchema } from '../types';

const LIST_SEPARATOR = String.fromCharCode(1);

function normalizeStringList(value: unknown, fallback: string[]): string[] {
    if (!Array.isArray(value)) return [...fallback];
    const cleaned = value.map((item) => String(item || '').trim()).filter(Boolean);
    return cleaned.length > 0 ? cleaned : [...fallback];
}

function parseListField(value: unknown): string[] {
    const text = String(value || '');
    if (!text) return [];
    return text.split(LIST_SEPARATOR).map((item) => item.trim()).filter(Boolean);
}

export class ExportMainImageDocumentsTool implements Tool {
    name = 'exportMainImageDocuments';

    schema: ToolSchema = {
        name: 'exportMainImageDocuments',
        description: '按用户导出规范批量导出主图与详情页：主图文档（800/750/1200）的「转化图」「点击图」父组下每个子组导出一张 JPEG（质量自适应≤3MB）到 <导出目录>/主图/<尺寸>/；详情页文档按切片 Save For Web 导出到 <导出目录>。未打开的文档记录跳过不中断；每个文档处理后恢复历史状态。',
        parameters: {
            type: 'object',
            properties: {
                outputDir: {
                    type: 'string',
                    description: '导出父目录绝对路径（如项目的 导出/ 目录）'
                },
                documents: {
                    type: 'array',
                    items: { type: 'string' },
                    description: '要处理的文档名（去扩展名匹配已打开文档），默认 ["800","750","1200","详情页"]；可只传 ["详情页"] 单独导详情页'
                },
                mainImageGroups: {
                    type: 'array',
                    items: { type: 'string' },
                    description: '主图文档里要导出的父图层组，默认 ["转化图","点击图"]'
                },
                maxFileSizeMB: {
                    type: 'number',
                    description: '单张 JPEG 大小上限（超过自动降质，最低质量 10），默认 3'
                }
            },
            required: ['outputDir']
        }
    };

    async execute(params: {
        outputDir: string;
        documents?: string[];
        mainImageGroups?: string[];
        maxFileSizeMB?: number;
    }): Promise<ToolResult<any>> {
        const outputDir = String(params.outputDir || '').trim();
        if (!outputDir) {
            return { success: false, error: 'exportMainImageDocuments 需要 outputDir：导出父目录的绝对路径。', data: null };
        }
        const documents = normalizeStringList(params.documents, ['800', '750', '1200', '详情页']);
        const mainImageGroups = normalizeStringList(params.mainImageGroups, ['转化图', '点击图']);
        const maxFileSizeMB = Number.isFinite(Number(params.maxFileSizeMB)) && Number(params.maxFileSizeMB) > 0
            ? Number(params.maxFileSizeMB)
            : 3;

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

var SEP = String.fromCharCode(1);
var BASE_DIR = ${JSON.stringify(outputDir)};
var DOCS = ${JSON.stringify(documents)};
var MAIN_GROUPS = ${JSON.stringify(mainImageGroups)};
var MAX_MB = ${JSON.stringify(maxFileSizeMB)};

var report = { success: [], failure: [], skipped: [], notFound: [] };

function findDocumentByName(name) {
    for (var i = 0; i < app.documents.length; i++) {
        var doc = app.documents[i];
        if (doc.name.replace(/\\.[^\\.]+$/, '') === name) return doc;
    }
    return null;
}

function hideAllTopLevelLayers(doc) {
    for (var i = 0; i < doc.layers.length; i++) {
        doc.layers[i].visible = false;
    }
}

function isEmptyLayerSet(layerSet) {
    if (layerSet.artLayers.length > 0) return false;
    for (var i = 0; i < layerSet.layerSets.length; i++) {
        if (!isEmptyLayerSet(layerSet.layerSets[i])) return false;
    }
    return true;
}

function exportLayerAsJPEG(doc, layer, exportFolder) {
    var layerName = layer.name;
    try {
        var fileName = layerName.replace(/[\\/\\\\:*?"<>|]/g, '_');
        var file = new File(exportFolder.fsName + '/' + fileName + '.jpg');
        var jpegOptions = new JPEGSaveOptions();
        jpegOptions.quality = 12;
        var fileSizeMB;
        do {
            doc.saveAs(file, jpegOptions, true, Extension.LOWERCASE);
            fileSizeMB = file.length / 1024 / 1024;
            if (fileSizeMB > MAX_MB - 0.01) {
                if (jpegOptions.quality > 10) { jpegOptions.quality--; } else { break; }
            } else { break; }
        } while (true);
        report.success.push("文件 '" + fileName + ".jpg' (来自 " + doc.name + ") 已导出，质量 " + jpegOptions.quality + "，" + (Math.round(fileSizeMB * 100) / 100) + "MB");
    } catch (e) {
        report.failure.push("导出图层 '" + layerName + "' 从文档 '" + doc.name + "' 失败：" + e.message);
    }
}

function exportLayerSets(doc, parentGroupName, exportFolder) {
    try {
        var parentGroup = doc.layerSets.getByName(parentGroupName);
        hideAllTopLevelLayers(doc);
        parentGroup.visible = true;
        var exportedSomething = false;
        for (var i = 0; i < parentGroup.layerSets.length; i++) {
            var childSet = parentGroup.layerSets[i];
            if (!isEmptyLayerSet(childSet)) {
                childSet.visible = true;
                exportLayerAsJPEG(doc, childSet, exportFolder);
                childSet.visible = false;
                exportedSomething = true;
            }
        }
        if (!exportedSomething) {
            report.skipped.push("文档 '" + doc.name + "' 的图层组 '" + parentGroupName + "' 没有可导出的非空子图层组。");
        }
    } catch (e) {
        report.failure.push("文档 '" + doc.name + "' 中处理图层组 '" + parentGroupName + "' 失败（组不存在或被锁定）：" + e.message);
    }
}

function exportSlices(doc, exportFolder) {
    try {
        var options = new ExportOptionsSaveForWeb();
        options.format = SaveDocumentType.JPEG;
        options.quality = 100;
        options.optimized = true;
        var fileName = doc.name.replace(/\\.[^\\.]+$/, '');
        var exportPath = new File(exportFolder.fsName + '/' + fileName);
        doc.exportDocument(exportPath, ExportType.SAVEFORWEB, options);
        report.success.push("文档 '" + doc.name + "' 的全部切片已导出。");
    } catch (e) {
        report.failure.push("文档 '" + doc.name + "' 切片导出失败（请确认已设置切片）：" + e.message);
    }
}

try {
    if (!app.documents.length) throw new Error('没有打开任何 Photoshop 文档');

    var baseFolder = new Folder(BASE_DIR);
    if (!baseFolder.exists && !baseFolder.create()) {
        throw new Error('导出目录不可用：' + BASE_DIR);
    }

    var exportFolders = {};
    for (var d = 0; d < DOCS.length; d++) {
        var docKey = DOCS[d];
        if (docKey === '详情页') {
            exportFolders[docKey] = baseFolder;
        } else {
            var folder = new Folder(baseFolder.fsName + '/主图/' + docKey);
            if (!folder.exists) folder.create();
            exportFolders[docKey] = folder;
        }
    }

    for (var i = 0; i < DOCS.length; i++) {
        var docName = DOCS[i];
        var doc = findDocumentByName(docName);
        if (!doc) {
            report.notFound.push(docName);
            continue;
        }
        app.activeDocument = doc;
        var startState = doc.activeHistoryState;
        try {
            if (docName === '详情页') {
                exportSlices(doc, exportFolders[docName]);
            } else {
                for (var g = 0; g < MAIN_GROUPS.length; g++) {
                    exportLayerSets(doc, MAIN_GROUPS[g], exportFolders[docName]);
                }
            }
        } catch (docError) {
            report.failure.push("处理文档 '" + doc.name + "' 时发生未知错误：" + docError.message);
        }
        doc.activeHistoryState = startState;
    }

    __deResult({
        success: 1,
        successList: report.success.join(SEP),
        failureList: report.failure.join(SEP),
        skippedList: report.skipped.join(SEP),
        notFoundList: report.notFound.join(SEP),
        baseDir: baseFolder.fsName
    });
} catch (e) {
    __deResult({ success: 0, error: String(e && e.message ? e.message : e) });
} finally {
    try { app.displayDialogs = __dePrevDialogs; } catch (restoreError) {}
}
__deOutput;
`;

        try {
            const bridgeResult = await runJsxCode(jsx, 'DesignEcho: 主图/详情页批量导出');
            const data = bridgeResult.data as Record<string, any> | null;
            if (!data || String(data.success) !== '1') {
                return {
                    success: false,
                    error: `主图/详情页批量导出失败：${data?.error || bridgeResult.message || '未知错误'}`,
                    data: null
                };
            }
            const success = parseListField(data.successList);
            const failure = parseListField(data.failureList);
            const skipped = parseListField(data.skippedList);
            const notFound = parseListField(data.notFoundList);
            const summaryParts = [
                `成功 ${success.length} 项`,
                failure.length ? `失败 ${failure.length} 项` : '',
                skipped.length ? `跳过 ${skipped.length} 项` : '',
                notFound.length ? `未打开的文档：${notFound.join('、')}` : ''
            ].filter(Boolean);
            return {
                success: failure.length === 0,
                message: `主图/详情页批量导出完成（${summaryParts.join('；')}）。导出目录：${data.baseDir || outputDir}`,
                ...(failure.length > 0 ? { error: `部分导出失败：${failure.join('；')}` } : {}),
                data: {
                    outputDir: String(data.baseDir || outputDir),
                    report: { success, failure, skipped, notFound }
                }
            };
        } catch (error) {
            return createToolFailureResult({ toolName: this.name, error, params });
        }
    }
}
