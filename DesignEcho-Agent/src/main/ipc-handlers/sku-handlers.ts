/**
 * SKU 批量生成 IPC 处理器
 */

import { ipcMain, dialog } from 'electron';
import * as fs from 'fs/promises';
import { skuConfigService } from '../services/sku-config-service';
import type { IPCContext } from './types';

export function registerSKUHandlers(_context: IPCContext): void {
    console.log('[IPC] 注册 SKU 处理器');

    // 自动加载项目配置
    ipcMain.handle('sku:autoLoadConfig', async (_, projectPath: string) => {
        try {
            return await skuConfigService.autoLoadFromProject(projectPath);
        } catch (error: any) {
            console.error('[SKU] 自动加载配置失败:', error);
            return null;
        }
    });

    // 从 PSD 提取图层组（调用 UXP 或使用 ag-psd）
    ipcMain.handle('sku:extractLayerGroups', async (_, psdPath: string) => {
        try {
            // 使用 ag-psd 解析 PSD 获取图层组信息
            // 跳过所有图像数据以避免 Canvas 初始化需求
            const agPsd = require('ag-psd');
            const buffer = await fs.readFile(psdPath);
            const psd = agPsd.readPsd(buffer, { 
                skipLayerImageData: true,
                skipCompositeImageData: true,
                skipThumbnail: true
            });
            
            const layerGroups: Array<{ name: string; dominantColor?: string }> = [];
            
            if (psd.children) {
                for (const child of psd.children) {
                    if (child.children) {  // 是图层组
                        layerGroups.push({
                            name: child.name || `图层组 ${layerGroups.length + 1}`,
                            dominantColor: undefined
                        });
                    }
                }
            }
            
            console.log(`[SKU] 从 PSD 提取 ${layerGroups.length} 个图层组`);
            return layerGroups;
        } catch (error: any) {
            console.error('[SKU] 提取图层组失败:', error);
            return [];
        }
    });

    // 解析颜色配置 CSV
    ipcMain.handle('sku:parseColorConfig', async (_, csvPath: string) => {
        try {
            return await skuConfigService.parseColorConfig(csvPath);
        } catch (error: any) {
            console.error('[SKU] 解析颜色配置失败:', error);
            throw error;
        }
    });

    // 解析模板配置 CSV
    ipcMain.handle('sku:parseTemplateConfig', async (_, csvPath: string) => {
        try {
            return await skuConfigService.parseTemplateConfig(csvPath);
        } catch (error: any) {
            console.error('[SKU] 解析模板配置失败:', error);
            throw error;
        }
    });

    // 生成组合列表
    ipcMain.handle('sku:generateCombinations', async (_, params: {
        templateConfigs: any[];
        colorConfigs: any[];
        outputDir: string;
        outputPattern: string;
    }) => {
        try {
            return skuConfigService.generateCombinations(
                params.templateConfigs,
                params.colorConfigs,
                params.outputDir,
                params.outputPattern
            );
        } catch (error: any) {
            console.error('[SKU] 生成组合失败:', error);
            throw error;
        }
    });

    // 验证配置
    ipcMain.handle('sku:validateConfig', async (_, config: any) => {
        return skuConfigService.validateConfig(config);
    });

    // 生成执行指令
    ipcMain.handle('sku:generateInstructions', async (_, params: {
        combination: any;
        sourcePsdPath: string;
        templateDir: string;
    }) => {
        return skuConfigService.generateExecutionInstructions(
            params.combination,
            params.sourcePsdPath,
            params.templateDir
        );
    });

    // 选择文件对话框
    ipcMain.handle('dialog:selectFile', async (_, options: {
        filters?: Array<{ name: string; extensions: string[] }>;
        multiple?: boolean;
    }) => {
        const result = await dialog.showOpenDialog({
            properties: options.multiple ? ['openFile', 'multiSelections'] : ['openFile'],
            filters: options.filters
        });
        
        if (result.canceled || result.filePaths.length === 0) {
            return null;
        }
        
        return options.multiple ? result.filePaths : result.filePaths[0];
    });

    console.log('[IPC] SKU 处理器注册完成');
}
