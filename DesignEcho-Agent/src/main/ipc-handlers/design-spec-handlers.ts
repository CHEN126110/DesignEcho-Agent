/**
 * 设计规范 IPC 处理器
 */

import { ipcMain } from 'electron';
import { designSpecService, DesignContext } from '../services/design-spec-service';
import type { IPCContext } from './types';

export function registerDesignSpecHandlers(_context: IPCContext): void {
    console.log('[IPC] 注册设计规范处理器');

    // 检查设计是否符合规范
    ipcMain.handle('designSpec:check', async (_event, context: DesignContext) => {
        return designSpecService.check(context);
    });

    // 获取特定类型的规范要求
    ipcMain.handle('designSpec:getRequirements', async (_event, type: 'mainImage' | 'sku' | 'detailPage') => {
        return designSpecService.getRequirements(type);
    });

    // 获取所有规则
    ipcMain.handle('designSpec:getRules', async () => {
        // 返回规则的简化版本（不包含 check 函数）
        return designSpecService.getRules().map(rule => ({
            id: rule.id,
            name: rule.name,
            description: rule.description,
            category: rule.category,
            severity: rule.severity
        }));
    });

    // 快速检查尺寸
    ipcMain.handle('designSpec:checkDimensions', async (_event, 
        type: 'mainImage' | 'sku' | 'detailPage', 
        width: number, 
        height: number
    ) => {
        return designSpecService.checkDimensions(type, width, height);
    });

    // 获取规范建议
    ipcMain.handle('designSpec:getSuggestions', async (_event, type: 'mainImage' | 'sku' | 'detailPage') => {
        return designSpecService.getSuggestions(type);
    });

    console.log('[IPC] 设计规范处理器注册完成');
}
