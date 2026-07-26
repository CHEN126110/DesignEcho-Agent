/**
 * 直接导出服务
 * 
 * 使用 batchPlay 执行 JSX 脚本，通过 token/临时 JSX 完成受控保存
 * 参考：https://blog.cutterman.cn/2025/02/02/uxp-run-jsx/
 * 
 * 核心原理：使用临时 JSX 文件 + token 的方式执行脚本
 */

const { action, core } = require('photoshop');
const uxp = require('uxp');
const storage = uxp.storage;
const fs = storage.localFileSystem as any;

/** 已确保存在的目录缓存，避免重复创建 */
const ensuredDirs = new Set<string>();

/**
 * 使用 JSX 脚本保存 JPEG 文件（通过 token/临时 JSX 完成受控保存）
 * 
 * 方法：创建临时 JSX 文件 → 获取 token → 执行脚本
 * 
 * @param outputPath 完整输出路径（如 D:\DesignEchoDemo\C-1021\SKU\test.jpg）
 * @param quality JPEG 质量 (1-12)
 * @returns 是否成功
 */
export async function saveAsJPEGViaJSX(outputPath: string, quality: number = 12): Promise<boolean> {
    // 统一正斜杠：ExtendScript File/Folder 原生支持 URI 风格路径；
    // 反斜杠经多层字符串传输极易被当转义字符吞掉（实测：含中文的路径整段丢分隔符落到盘根）
    const escapedPath = outputPath.replace(/\\+/g, '/');
    
    // JSX 脚本：保存当前文档为 JPEG
    const jsxScript = `
try {
    var doc = app.activeDocument;
    var saveFile = new File("${escapedPath}");
    
    // 确保父目录存在
    var parentFolder = saveFile.parent;
    if (!parentFolder.exists) {
        parentFolder.create();
    }
    
    var jpegOptions = new JPEGSaveOptions();
    jpegOptions.quality = ${quality};
    jpegOptions.embedColorProfile = true;
    jpegOptions.formatOptions = FormatOptions.STANDARDBASELINE;
    
    doc.saveAs(saveFile, jpegOptions, true, Extension.LOWERCASE);
    "SUCCESS";
} catch(e) {
    "ERROR:" + e.message;
}
`;
    
    try {
        // 1. 获取临时目录
        const tempFolder = await fs.getTemporaryFolder();
        
        // 2. 创建临时 JSX 文件
        const jsxFileName = `save_jpeg_${Date.now()}.jsx`;
        const jsxFile = await tempFolder.createFile(jsxFileName, { overwrite: true });
        
        // 使用 UTF-8 BOM 确保编码正确
        const bom = '\uFEFF';
        await jsxFile.write(bom + jsxScript, { format: storage.formats.utf8 });
        
        // 3. 为 JSX 文件创建 token
        const jsxToken = await fs.createSessionToken(jsxFile);
        
        // 4. 使用 batchPlay 执行 JSX 脚本
        let batchResult: any = null;
        
        await core.executeAsModal(async () => {
            batchResult = await action.batchPlay([{
                _obj: "AdobeScriptAutomation Scripts",
                javaScript: {
                    _path: jsxToken,
                    _kind: "local"
                },
                javaScriptMessage: "saveJPEG"
            }], { synchronousExecution: true });
            
            console.log(`[ExportFolderService] batchPlay 结果:`, JSON.stringify(batchResult));
        }, { commandName: "保存 JPEG (JSX)" });
        
        // 5. 清理临时文件
        try {
            await jsxFile.delete();
        } catch (e) {
            // 忽略删除错误
        }
        
        // 6. 检查结果
        const resultMessage = batchResult?.[0]?.javaScriptMessage || '';
        
        if (resultMessage === 'SUCCESS' || resultMessage === '') {
            return true;
        } else if (resultMessage.startsWith('ERROR:')) {
            console.error(`[ExportFolderService] JSX 保存失败: ${resultMessage.substring(6)}`);
            return false;
        }
        
        // 默认认为成功（脚本可能没有返回值）
        return true;
    } catch (e: any) {
        console.error(`[ExportFolderService] JSX 执行异常:`, e);
        console.error(`[ExportFolderService] 异常详情: name=${e?.name}, message=${e?.message}, stack=${e?.stack}`);
        return false;
    }
}

/**
 * 使用 JSX 脚本确保目录存在
 * 
 * @param dirPath 目录路径
 * @returns 是否成功
 */
export async function ensureDirectoryViaJSX(dirPath: string): Promise<boolean> {
    const normalized = dirPath.replace(/[/\\]+/g, '\\').replace(/\\+$/, '');
    if (ensuredDirs.has(normalized)) return true;

    // 统一正斜杠进 JSX（同 saveAsJPEGViaJSX，防反斜杠被转义吞掉）
    const escapedPath = dirPath.replace(/\\+/g, '/');
    
    const jsxScript = `
try {
    var folder = new Folder("${escapedPath}");
    if (!folder.exists) {
        folder.create();
    }
    folder.exists ? "SUCCESS" : "ERROR:创建失败";
} catch(e) {
    "ERROR:" + e.message;
}
`;
    
    try {
        // 1. 获取临时目录
        const tempFolder = await fs.getTemporaryFolder();
        
        // 2. 创建临时 JSX 文件
        const jsxFileName = `ensure_dir_${Date.now()}.jsx`;
        const jsxFile = await tempFolder.createFile(jsxFileName, { overwrite: true });
        await jsxFile.write(jsxScript);
        
        // 3. 为 JSX 文件创建 token
        const jsxToken = await fs.createSessionToken(jsxFile);
        
        // 4. 执行 JSX 脚本
        let resultMessage = '';
        
        await core.executeAsModal(async () => {
            const result = await action.batchPlay([{
                _obj: "AdobeScriptAutomation Scripts",
                javaScript: {
                    _path: jsxToken,
                    _kind: "local"
                },
                javaScriptMessage: "ensureDir"
            }], { synchronousExecution: true });
            
            resultMessage = result?.[0]?.javaScriptMessage || '';
        }, { commandName: "创建目录 (JSX)" });
        
        // 5. 清理临时文件
        try {
            await jsxFile.delete();
        } catch (e) {
            // 忽略删除错误
        }
        
        const ok = resultMessage === 'SUCCESS' || resultMessage === '' || !resultMessage.startsWith('ERROR:');
        if (ok) ensuredDirs.add(normalized);
        return ok;
    } catch (e: any) {
        console.error(`[ExportFolderService] 创建目录异常: ${e.message}`);
        return false;
    }
}

/**
 * 获取导出目标信息（兼容旧接口，但使用 JSX 方法）
 * 
 * 注意：此函数现在只返回路径信息，实际保存使用 saveAsJPEGViaJSX
 */
export async function getDirectExportTarget(
    targetDir: string, 
    fileName: string
): Promise<{ fullPath: string } | null> {
    const fullPath = `${targetDir}\\${fileName}`;
    console.log(`[ExportFolderService] 目标路径: ${fullPath}`);
    
    // 确保目录存在
    const dirReady = await ensureDirectoryViaJSX(targetDir);
    if (!dirReady) {
        console.error(`[ExportFolderService] 无法创建目录: ${targetDir}`);
        return null;
    }
    
    return { fullPath };
}
