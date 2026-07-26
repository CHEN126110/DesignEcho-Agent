/**
 * 撤销/重做工具
 * 
 * 调用 Photoshop 内置的撤销/重做功能
 */

import { Tool, ToolSchema } from '../types';

const app = require('photoshop').app;
const { core } = require('photoshop');
const { action } = require('photoshop');

/**
 * 读当前历史状态索引（1 基）。undo/redo 以此为依据验证历史是否真的移动，
 * 不允许"恒报成功"。读不到就让外层按失败处理。
 */
async function readCurrentHistoryStateIndex(): Promise<number | null> {
    const result = await action.batchPlay([
        {
            _obj: 'get',
            _target: [
                { _property: 'historyState' },
                { _ref: 'document', _enum: 'ordinal', _value: 'targetEnum' }
            ],
            _options: { dialogOptions: 'dontDisplay' }
        }
    ], {});
    const index = result[0]?.historyState?._index;
    return typeof index === 'number' ? index : null;
}

export class UndoTool implements Tool {
    name = 'undo';

    schema: ToolSchema = {
        name: 'undo',
        description: '撤销上一步操作',
        parameters: {
            type: 'object',
            properties: {
                steps: {
                    type: 'number',
                    description: '撤销的步数，默认为 1'
                }
            }
        }
    };

    async execute(params: { steps?: number }): Promise<{
        success: boolean;
        message?: string;
        error?: string;
    }> {
        try {
            const doc = app.activeDocument;
            if (!doc) {
                return { success: false, error: '没有打开的文档' };
            }

            const steps = params.steps || 1;

            const beforeIndex = await readCurrentHistoryStateIndex();
            if (beforeIndex === null) {
                return { success: false, error: '无法读取历史状态，不能确认可撤销步数' };
            }
            if (beforeIndex <= 1) {
                return { success: false, error: '没有可撤销的历史状态' };
            }

            await core.executeAsModal(async () => {
                for (let i = 0; i < steps; i++) {
                    await action.batchPlay([
                        {
                            _obj: 'select',
                            _target: [
                                { _ref: 'historyState', _enum: 'ordinal', _value: 'previous' }
                            ],
                            _options: { dialogOptions: 'dontDisplay' }
                        }
                    ], {});
                }
            }, { commandName: 'DesignEcho: 撤销' });

            const afterIndex = await readCurrentHistoryStateIndex();
            const undone = beforeIndex - (afterIndex ?? beforeIndex);
            if (undone <= 0) {
                return { success: false, error: '撤销未生效：历史状态没有变化' };
            }
            if (undone < steps) {
                return {
                    success: true,
                    message: `已撤销 ${undone} 步操作（请求 ${steps} 步，历史深度不足）`
                };
            }

            return {
                success: true,
                message: `已撤销 ${undone} 步操作`
            };

        } catch (error) {
            console.error('[Undo] Error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : '撤销失败'
            };
        }
    }
}

export class RedoTool implements Tool {
    name = 'redo';

    schema: ToolSchema = {
        name: 'redo',
        description: '重做上一步被撤销的操作',
        parameters: {
            type: 'object',
            properties: {
                steps: {
                    type: 'number',
                    description: '重做的步数，默认为 1'
                }
            }
        }
    };

    async execute(params: { steps?: number }): Promise<{
        success: boolean;
        message?: string;
        error?: string;
    }> {
        try {
            const doc = app.activeDocument;
            if (!doc) {
                return { success: false, error: '没有打开的文档' };
            }

            const steps = params.steps || 1;

            const beforeIndex = await readCurrentHistoryStateIndex();
            if (beforeIndex === null) {
                return { success: false, error: '无法读取历史状态，不能确认可重做步数' };
            }

            await core.executeAsModal(async () => {
                for (let i = 0; i < steps; i++) {
                    await action.batchPlay([
                        {
                            _obj: 'select',
                            _target: [
                                { _ref: 'historyState', _enum: 'ordinal', _value: 'next' }
                            ],
                            _options: { dialogOptions: 'dontDisplay' }
                        }
                    ], {});
                }
            }, { commandName: 'DesignEcho: 重做' });

            const afterIndex = await readCurrentHistoryStateIndex();
            const redone = (afterIndex ?? beforeIndex) - beforeIndex;
            if (redone <= 0) {
                return { success: false, error: '没有可重做的历史状态' };
            }
            if (redone < steps) {
                return {
                    success: true,
                    message: `已重做 ${redone} 步操作（请求 ${steps} 步，后面没有更多历史）`
                };
            }

            return {
                success: true,
                message: `已重做 ${redone} 步操作`
            };

        } catch (error) {
            console.error('[Redo] Error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : '重做失败'
            };
        }
    }
}

/**
 * 获取历史记录信息工具
 */
export class GetHistoryInfoTool implements Tool {
    name = 'getHistoryInfo';

    schema: ToolSchema = {
        name: 'getHistoryInfo',
        description: '获取当前文档的历史记录信息',
        parameters: {
            type: 'object',
            properties: {}
        }
    };

    async execute(): Promise<{
        success: boolean;
        historyCount?: number;
        currentState?: number;
        canUndo?: boolean;
        canRedo?: boolean;
        error?: string;
    }> {
        try {
            const doc = app.activeDocument;
            if (!doc) {
                return { success: false, error: '没有打开的文档' };
            }

            // 使用 batchPlay 获取历史记录信息
            const historyInfo = await action.batchPlay([
                {
                    _obj: 'get',
                    _target: [
                        { _property: 'historyState' },
                        { _ref: 'document', _enum: 'ordinal', _value: 'targetEnum' }
                    ],
                    _options: { dialogOptions: 'dontDisplay' }
                }
            ], {});

            // 获取历史状态数量
            const countResult = await action.batchPlay([
                {
                    _obj: 'get',
                    _target: [
                        { _property: 'count' },
                        { _ref: 'historyState', _index: 1 }
                    ],
                    _options: { dialogOptions: 'dontDisplay' }
                }
            ], {});

            const historyCount = countResult[0]?.count || 0;
            const currentState = historyInfo[0]?.historyState?._index || 1;

            return {
                success: true,
                historyCount,
                currentState,
                canUndo: currentState > 1,
                canRedo: currentState < historyCount
            };

        } catch (error) {
            console.error('[GetHistoryInfo] Error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : '获取历史记录失败'
            };
        }
    }
}
