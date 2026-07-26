import type { SkillExecutor, SkillExecuteParams } from './types';
import type { AgentResult } from '../unified-agent.service';
import { executeToolCall } from '../tool-executor.service';

export const skuConfigExecutor: SkillExecutor = {
    skillId: 'sku-config',

    async execute({ params, callbacks }: SkillExecuteParams): Promise<AgentResult> {
        const action = String(params?.action || '').trim();

        if (!action) {
            return {
                success: false,
                message: 'SKU 配置操作缺少 action。可用值：exportColors / createPlaceholders / getPlaceholders。',
                error: 'Missing sku-config action',
                data: {
                    skillSelectionRequired: true,
                    availableActions: ['exportColors', 'createPlaceholders', 'getPlaceholders'],
                    relatedWorkflowSkillId: 'sku-batch'
                }
            };
        }

        if (action === 'exportColors') {
            callbacks?.onToolStart?.('exportColorConfig');
            const result = await executeToolCall('exportColorConfig', {});
            callbacks?.onToolComplete?.('exportColorConfig', result);
            return {
                success: result?.success !== false,
                message: result?.message || (result?.success !== false ? '颜色配置已导出。' : '导出颜色配置失败。'),
                toolResults: [{ toolName: 'exportColorConfig', result }],
                error: result?.success === false ? (result?.error || 'exportColorConfig failed') : undefined,
                data: result?.data
            };
        }

        if (action === 'createPlaceholders') {
            // 前置文档检查：createSkuPlaceholders 需要打开的文档才能操作
            callbacks?.onToolStart?.('getDocumentInfo');
            const docInfo = await executeToolCall('getDocumentInfo', {});
            callbacks?.onToolComplete?.('getDocumentInfo', docInfo);
            if (docInfo?.success === false) {
                return {
                    success: false,
                    message: '当前没有打开的 Photoshop 文档，无法创建 SKU 占位符。请先打开或创建一个文档。',
                    toolResults: [{ toolName: 'getDocumentInfo', result: docInfo }],
                    error: docInfo?.error || '没有打开的文档'
                };
            }

            const payload = {
                count: Number(params?.placeholderCount || 5),
                layout: params?.layout || 'horizontal'
            };
            callbacks?.onToolStart?.('createSkuPlaceholders');
            const result = await executeToolCall('createSkuPlaceholders', payload);
            callbacks?.onToolComplete?.('createSkuPlaceholders', result);
            return {
                success: result?.success !== false,
                message: result?.message || (result?.success !== false ? 'SKU 占位符创建完成。' : '创建 SKU 占位符失败。'),
                toolResults: [
                    { toolName: 'getDocumentInfo', result: docInfo },
                    { toolName: 'createSkuPlaceholders', result }
                ],
                error: result?.success === false ? (result?.error || 'createSkuPlaceholders failed') : undefined,
                data: result?.data
            };
        }

        if (action === 'getPlaceholders') {
            callbacks?.onToolStart?.('getSkuPlaceholders');
            const result = await executeToolCall('getSkuPlaceholders', {});
            callbacks?.onToolComplete?.('getSkuPlaceholders', result);
            return {
                success: result?.success !== false,
                message: result?.message || (result?.success !== false ? '已获取 SKU 占位符信息。' : '获取 SKU 占位符失败。'),
                toolResults: [{ toolName: 'getSkuPlaceholders', result }],
                error: result?.success === false ? (result?.error || 'getSkuPlaceholders failed') : undefined,
                data: result?.data
            };
        }

        return {
            success: false,
            message: `不支持的 sku-config action: ${action}`,
            error: 'Unsupported sku-config action'
        };
    }
};
