/**
 * 切片导出工具
 * @description 按屏导出详情页切片为 JPEG/PNG 文件
 */

import { app, action, core, imaging } from 'photoshop';
import { saveAsJPEGViaJSX, ensureDirectoryViaJSX } from './export-folder-service';
import { getEntryFromPath } from '../../core/file-url';

const uxpStorage = require('uxp').storage;

// ==================== 类型定义 ====================

interface BoundingBox {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
}

type ScreenType = string;

interface ParsedScreen {
    id: number;
    name: string;
    type: ScreenType;
    index: number;
    bounds: BoundingBox;
    visible: boolean;
}

interface SliceExportConfig {
    outputDir: string;
    format: 'jpeg' | 'png';
    quality: number;
    namingPattern: string;
    createSubfolder: boolean;
    subfolder: string;
}

interface ScreenExportResult {
    index: number;
    name: string;
    type: ScreenType;
    path: string;
    size: { width: number; height: number };
    fileSize?: number;
}

interface SliceExportResult {
    success: boolean;
    screens: ScreenExportResult[];
    outputDir: string;
    totalScreens: number;
    successCount: number;
    failedCount: number;
    totalTime: number;
    errors?: string[];
}

// ==================== 导出器类 ====================

export class SliceExporter {
    
    /**
     * 导出所有屏为切片
     */
    async exportAll(
        screens: ParsedScreen[],
        config: SliceExportConfig
    ): Promise<SliceExportResult> {
        const startTime = Date.now();
        const results: ScreenExportResult[] = [];
        const errors: string[] = [];
        const fallbackReasons: string[] = [];
        
        const doc = app.activeDocument;
        if (!doc) {
            return {
                success: false,
                screens: [],
                outputDir: config.outputDir,
                totalScreens: 0,
                successCount: 0,
                failedCount: 0,
                totalTime: 0,
                errors: ['没有打开的文档']
            };
        }
        
        // 保存原始可见性状态
        const originalState = await this.captureVisibilityState(doc);
        
        // 确保输出目录存在（统一正斜杠拼接，防反斜杠在 JSX 层被吞）
        const outputDir = config.createSubfolder
            ? `${config.outputDir}/${config.subfolder}`
            : config.outputDir;
        
        console.log(`[SliceExporter] 输出目录: ${outputDir}`);
        
        const dirReady = await ensureDirectoryViaJSX(outputDir);
        if (!dirReady) {
            return {
                success: false,
                screens: [],
                outputDir,
                totalScreens: screens.length,
                successCount: 0,
                failedCount: screens.length,
                totalTime: Date.now() - startTime,
                errors: [`无法创建输出目录: ${outputDir}`]
            };
        }
        
        console.log(`[SliceExporter] 开始导出 ${screens.length} 屏`);
        
        try {
            for (let i = 0; i < screens.length; i++) {
                const screen = screens[i];
                
                try {
                    console.log(`[SliceExporter] 导出屏 ${i + 1}/${screens.length}: ${screen.name}`);
                    // 快路径：imaging.getPixels 区域取像素直接落盘，不裁切文档、不动历史
                    // （旧 crop→saveAs→历史回退 路径在 1.6GB PSB 上每屏 ~11s，且中断会留下半裁切状态）。
                    // 失败时回退旧路径，保持导出能力不丢失。
                    let result: ScreenExportResult;
                    try {
                        result = await this.exportScreenViaImaging(screen, i, outputDir, config, doc);
                    } catch (imagingError: any) {
                        const reason = `imaging 快路径失败（屏 ${screen.name}）：${imagingError?.message || imagingError}`;
                        console.warn(`[SliceExporter] ${reason}，回退裁切导出`);
                        fallbackReasons.push(reason);
                        result = await this.exportScreen(screen, i, outputDir, config, doc);
                    }
                    results.push(result);
                    console.log(`[SliceExporter] ✅ 导出成功: ${result.path}`);
                } catch (e: any) {
                    const errorMsg = `屏 ${i + 1} 导出失败: ${e.message}`;
                    errors.push(errorMsg);
                    console.error(`[SliceExporter] ❌ ${errorMsg}`);
                }
            }
        } finally {
            // 恢复原始可见性状态
            await this.restoreVisibilityState(doc, originalState);
        }
        
        const allMessages = [...errors, ...fallbackReasons];
        const result: SliceExportResult = {
            success: errors.length === 0,
            screens: results,
            outputDir,
            totalScreens: screens.length,
            successCount: results.length,
            failedCount: errors.length,
            totalTime: Date.now() - startTime,
            errors: allMessages.length > 0 ? allMessages : undefined
        };
        
        console.log(`[SliceExporter] 导出完成: ${results.length}/${screens.length} 成功, 耗时 ${result.totalTime}ms`);
        
        return result;
    }
    
    /** clamp 屏边界到画布内（出血部分画布外不可见，导出按画布内区域） */
    private clampScreenBoundsToCanvas(
        screen: ParsedScreen,
        doc: any
    ): { left: number; top: number; right: number; bottom: number; width: number; height: number } {
        const docWidth = Number(doc.width);
        const docHeight = Number(doc.height);
        const left = Math.max(0, Math.round(screen.bounds.left));
        const top = Math.max(0, Math.round(screen.bounds.top));
        const right = Math.min(docWidth, Math.round(screen.bounds.right));
        const bottom = Math.min(docHeight, Math.round(screen.bounds.bottom));
        if (right - left < 4 || bottom - top < 4) {
            throw new Error(`屏 ${screen.name} 的边界与画布几乎无交集（${JSON.stringify(screen.bounds)}），无法导出。`);
        }
        return { left, top, right, bottom, width: right - left, height: bottom - top };
    }

    /**
     * 快路径导出单屏：可见性切换 → imaging.getPixels(区域合成像素) → encodeImageData(JPEG)
     * → UXP fullAccess 文件系统直接落盘。全程不修改文档（无裁切、无历史回退）。
     * 注意：encodeImageData 的 JPEG 质量不可配置，config.quality 仅对回退路径生效。
     */
    private async exportScreenViaImaging(
        screen: ParsedScreen,
        index: number,
        outputDir: string,
        config: SliceExportConfig,
        doc: any
    ): Promise<ScreenExportResult> {
        if (config.format !== 'jpeg') {
            throw new Error('imaging 快路径目前只输出 JPEG，PNG 走回退路径。');
        }
        const crop = this.clampScreenBoundsToCanvas(screen, doc);

        let base64 = '';
        await core.executeAsModal(async () => {
            // 只显示当前屏（与回退路径同一可见性语义；恢复由 exportAll 的 finally 统一做）
            for (const layer of doc.layers) {
                if (layer.kind === 'group') {
                    layer.visible = (layer.id === screen.id);
                }
            }
            const pixelResult = await imaging.getPixels({
                documentID: doc.id,
                sourceBounds: { left: crop.left, top: crop.top, right: crop.right, bottom: crop.bottom },
                // JPEG 编码不接受 alpha 通道：把 alpha 合成进 RGB（实测报错
                // "Image data with alpha cannot be encoded as jpeg"）
                applyAlpha: true
            });
            if (!pixelResult?.imageData) {
                throw new Error('imaging.getPixels 未返回像素数据');
            }
            try {
                const encoded = await imaging.encodeImageData({
                    imageData: pixelResult.imageData,
                    base64: true
                });
                if (!encoded || typeof encoded !== 'string') {
                    throw new Error('imaging.encodeImageData 未返回 base64');
                }
                base64 = encoded;
            } finally {
                pixelResult.imageData.dispose();
            }
        }, { commandName: `导出屏 ${index + 1}（imaging）` });

        const fileName = this.generateFileName(screen, index, config.namingPattern);
        const filePath = `${outputDir}/${fileName}.jpg`;
        await this.writeBase64File(filePath, base64);

        return {
            index,
            name: screen.name,
            type: screen.type,
            path: filePath,
            size: { width: crop.width, height: crop.height }
        };
    }

    /** base64 → 二进制写入任意路径（manifest localFileSystem=fullAccess） */
    private async writeBase64File(filePath: string, base64: string): Promise<void> {
        const fs = uxpStorage.localFileSystem;
        const normalizedPath = String(filePath || '').trim();
        const slashIndex = Math.max(normalizedPath.lastIndexOf('\\'), normalizedPath.lastIndexOf('/'));
        const directoryPath = slashIndex >= 0 ? normalizedPath.slice(0, slashIndex) : '';
        const fileName = slashIndex >= 0 ? normalizedPath.slice(slashIndex + 1) : normalizedPath;
        if (!directoryPath || !fileName) {
            throw new Error(`Invalid export file path: ${normalizedPath}`);
        }

        const directoryEntry = await getEntryFromPath(fs, directoryPath) as any;
        const entry = await directoryEntry.createFile(fileName, { overwrite: true }) as any;
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        await entry.write(bytes.buffer, { format: uxpStorage.formats.binary });
    }

    /**
     * 导出单个屏
     */
    private async exportScreen(
        screen: ParsedScreen,
        index: number,
        outputDir: string,
        config: SliceExportConfig,
        doc: any
    ): Promise<ScreenExportResult> {
        
        // 1. 隐藏其他屏，只显示当前屏
        await core.executeAsModal(async () => {
            for (const layer of doc.layers) {
                if (layer.kind === 'group') {
                    layer.visible = (layer.id === screen.id);
                }
            }
        }, { commandName: `显示屏 ${index + 1}` });
        
        // 2. 裁切到当前屏边界
        // 屏 bounds 常含画布外出血（left 为负），crop 矩形必须 clamp 到画布内，
        // 否则 batchPlay 静默失败、最终把整页当切片导出（实测 8 屏全为全页）。
        const originalWidth = Number(doc.width);
        const originalHeight = Number(doc.height);
        const cropLeft = Math.max(0, Math.round(screen.bounds.left));
        const cropTop = Math.max(0, Math.round(screen.bounds.top));
        const cropRight = Math.min(originalWidth, Math.round(screen.bounds.right));
        const cropBottom = Math.min(originalHeight, Math.round(screen.bounds.bottom));
        if (cropRight - cropLeft < 4 || cropBottom - cropTop < 4) {
            throw new Error(`屏 ${screen.name} 的边界与画布几乎无交集（${JSON.stringify(screen.bounds)}），无法裁切导出。`);
        }

        await core.executeAsModal(async () => {
            await action.batchPlay([{
                _obj: 'crop',
                to: {
                    _obj: 'rectangle',
                    top: { _unit: 'pixelsUnit', _value: cropTop },
                    left: { _unit: 'pixelsUnit', _value: cropLeft },
                    bottom: { _unit: 'pixelsUnit', _value: cropBottom },
                    right: { _unit: 'pixelsUnit', _value: cropRight }
                },
                angle: { _unit: 'angleUnit', _value: 0 },
                delete: true
            }], { synchronousExecution: true });
        }, { commandName: `裁切屏 ${index + 1}` });

        // 校验裁切真实生效——失败时必须报错，不能把整页当切片静默导出
        const croppedWidth = Number(doc.width);
        const croppedHeight = Number(doc.height);
        const expectedWidth = cropRight - cropLeft;
        const expectedHeight = cropBottom - cropTop;
        if (Math.abs(croppedWidth - expectedWidth) > 2 || Math.abs(croppedHeight - expectedHeight) > 2) {
            await core.executeAsModal(async () => {
                await action.batchPlay([{
                    _obj: 'select',
                    _target: [{ _ref: 'historyState', _offset: -1 }]
                }], { synchronousExecution: true });
            }, { commandName: '恢复裁切失败状态' });
            throw new Error(`屏 ${screen.name} 裁切未生效：期望 ${expectedWidth}x${expectedHeight}，实际 ${croppedWidth}x${croppedHeight}。`);
        }
        
        // 3. 生成文件名和路径
        const fileName = this.generateFileName(screen, index, config.namingPattern);
        const extension = config.format === 'jpeg' ? 'jpg' : 'png';
        const filePath = `${outputDir}/${fileName}.${extension}`;
        
        // 4. 导出
        let saved = false;
        if (config.format === 'jpeg') {
            saved = await saveAsJPEGViaJSX(filePath, config.quality);
        } else {
            // PNG 导出
            saved = await this.saveAsPNG(filePath);
        }
        
        // 5. 撤销裁切 (恢复原始尺寸)
        await core.executeAsModal(async () => {
            // 使用历史记录回退
            await action.batchPlay([{
                _obj: 'select',
                _target: [{ _ref: 'historyState', _offset: -1 }]
            }], { synchronousExecution: true });
        }, { commandName: `撤销裁切` });
        
        if (!saved) {
            throw new Error('导出失败');
        }
        
        return {
            index,
            name: screen.name,
            type: screen.type,
            path: filePath,
            // 返回裁切后的实际导出尺寸（出血被 clamp 进画布），不是屏 bounds 原始尺寸
            size: {
                width: expectedWidth,
                height: expectedHeight
            }
        };
    }
    
    /**
     * 保存为 PNG (使用 JSX)
     */
    private async saveAsPNG(outputPath: string): Promise<boolean> {
        const uxp = require('uxp');
        const fs = uxp.storage.localFileSystem;

        // 统一正斜杠进 JSX（防反斜杠被转义吞掉，详见 export-folder-service）
        const escapedPath = outputPath.replace(/\\+/g, '/');
        const jsxScript = `
try {
    var doc = app.activeDocument;
    var saveFile = new File("${escapedPath}");
    var parentFolder = saveFile.parent;
    if (!parentFolder.exists) {
        parentFolder.create();
    }
    var pngOptions = new PNGSaveOptions();
    pngOptions.compression = 6;
    pngOptions.interlaced = false;
    doc.saveAs(saveFile, pngOptions, true, Extension.LOWERCASE);
    "SUCCESS";
} catch(e) {
    "ERROR:" + e.message;
}
`;
        
        try {
            const tempFolder = await fs.getTemporaryFolder();
            const jsxFileName = `save_png_${Date.now()}.jsx`;
            const jsxFile = await tempFolder.createFile(jsxFileName, { overwrite: true });
            await jsxFile.write(jsxScript);
            const jsxToken = await fs.createSessionToken(jsxFile);
            
            let resultMessage = '';
            await core.executeAsModal(async () => {
                const result = await action.batchPlay([{
                    _obj: "AdobeScriptAutomation Scripts",
                    javaScript: {
                        _path: jsxToken,
                        _kind: "local"
                    },
                    javaScriptMessage: "savePNG"
                }], { synchronousExecution: true });
                resultMessage = result?.[0]?.javaScriptMessage || '';
            }, { commandName: "保存 PNG (JSX)" });
            
            // 清理临时文件
            try {
                await jsxFile.delete();
            } catch {
                // 忽略
            }
            
            return resultMessage === 'SUCCESS' || resultMessage === '' || !resultMessage.startsWith('ERROR:');
        } catch (e: any) {
            console.error(`[SliceExporter] PNG 导出异常: ${e.message}`);
            return false;
        }
    }
    
    /**
     * 生成文件名
     */
    private generateFileName(
        screen: ParsedScreen, 
        index: number, 
        pattern: string
    ): string {
        const paddedIndex = String(index + 1).padStart(2, '0');
        const safeName = screen.name.replace(/[\\/:*?"<>|]/g, '_');
        const typeShort = screen.type.split('_')[1] || screen.type;
        
        return pattern
            .replace('{index}', paddedIndex)
            .replace('{name}', safeName)
            .replace('{type}', typeShort);
    }
    
    /**
     * 捕获所有图层的可见性状态
     */
    private async captureVisibilityState(doc: any): Promise<Map<number, boolean>> {
        const state = new Map<number, boolean>();
        
        const capture = (layers: any[]) => {
            for (const layer of layers) {
                state.set(layer.id, layer.visible);
                if (layer.layers) {
                    capture(layer.layers);
                }
            }
        };
        
        if (doc.layers) {
            capture(Array.isArray(doc.layers) ? doc.layers : [doc.layers]);
        }
        
        return state;
    }
    
    /**
     * 恢复所有图层的可见性状态
     */
    private async restoreVisibilityState(
        doc: any, 
        state: Map<number, boolean>
    ): Promise<void> {
        await core.executeAsModal(async () => {
            const restore = (layers: any[]) => {
                for (const layer of layers) {
                    const originalVisible = state.get(layer.id);
                    if (originalVisible !== undefined) {
                        try {
                            layer.visible = originalVisible;
                        } catch {
                            // 忽略恢复失败
                        }
                    }
                    if (layer.layers) {
                        restore(layer.layers);
                    }
                }
            };
            
            if (doc.layers) {
                restore(Array.isArray(doc.layers) ? doc.layers : [doc.layers]);
            }
        }, { commandName: '恢复可见性' });
    }
}

// ==================== 工具类 ====================

export class SliceExporterTool {
    name = 'exportDetailPageSlices';
    
    schema = {
        name: 'exportDetailPageSlices',
        description: '按屏导出详情页切片为 JPEG/PNG 文件',
        parameters: {
            type: 'object' as const,
            properties: {
                screens: {
                    type: 'array',
                    description: '要导出的屏列表'
                },
                config: {
                    type: 'object',
                    description: '导出配置',
                    properties: {
                        outputDir: { type: 'string', description: '输出目录' },
                        format: { type: 'string', description: 'jpeg 或 png' },
                        quality: { type: 'number', description: 'JPEG 质量 1-12' },
                        namingPattern: { type: 'string', description: '命名模式' },
                        createSubfolder: { type: 'boolean', description: '是否创建子目录' },
                        subfolder: { type: 'string', description: '子目录名称' }
                    }
                }
            },
            required: ['screens', 'config'] as string[]
        }
    };
    
    async execute(params: { screens: ParsedScreen[]; config: SliceExportConfig }): Promise<SliceExportResult> {
        const exporter = new SliceExporter();
        return await exporter.exportAll(params.screens, params.config);
    }
}
