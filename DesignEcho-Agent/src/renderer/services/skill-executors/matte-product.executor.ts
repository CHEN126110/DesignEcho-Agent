/**
 * 抠图技能执行器
 */

import type { SkillExecutor, SkillExecuteParams } from './types';
import type { AgentResult } from '../unified-agent.service';
import { executeToolCall } from '../tool-executor.service';
import { emitSkillStep, executeObservedSkillTool } from './skill-step-events';

function summarizeMattingParams(params: Record<string, any>): string {
    const parts: string[] = [];
    const layerId = Number(params?.layerId);
    if (Number.isFinite(layerId) && layerId > 0) {
        parts.push(`目标图层 ID: ${layerId}`);
    } else {
        parts.push('目标图层: 当前选中图层');
    }

    const targetPrompt = String(params?.targetPrompt || '').trim();
    if (targetPrompt) {
        parts.push(`目标描述: ${targetPrompt}`);
    }

    const quality = params?.quality;
    if (quality !== undefined && quality !== null && String(quality).trim()) {
        parts.push(`质量: ${String(quality).trim()}`);
    }

    const maxSize = Number(params?.maxSize);
    if (Number.isFinite(maxSize) && maxSize > 0) {
        parts.push(`模型输入最长边: ${Math.round(maxSize)}px`);
    }

    if (params?.useMask === true) {
        parts.push('输出: 蒙版');
    } else if (params?.createNewLayer === false) {
        parts.push('输出: 覆盖原图层');
    } else {
        parts.push('输出: 新图层');
    }

    return parts.join('；');
}

function summarizeMattingResult(result: any): string {
    if (!result || result.success === false) {
        return String(result?.error || result?.message || '抠图工具返回失败');
    }

    const parts: string[] = [];
    if (result.newLayerId) {
        parts.push(`新图层 ID: ${result.newLayerId}`);
    } else if (result.layerId) {
        parts.push(`图层 ID: ${result.layerId}`);
    }
    if (result.usedMode) {
        parts.push(`模式: ${result.usedMode}`);
    }
    if (result.targetPrompt) {
        parts.push(`目标: ${result.targetPrompt}`);
    }
    if (Number.isFinite(Number(result.processingTime))) {
        parts.push(`耗时: ${Number(result.processingTime)}ms`);
    }
    if (result.useBinaryTransfer === true) {
        const width = Number(result.binaryImageWidth || 0);
        const height = Number(result.binaryImageHeight || 0);
        parts.push(width > 0 && height > 0 ? `传输: 二进制 ${width}x${height}` : '传输: 二进制');
    }
    if (result.fallbackReason) {
        parts.push(`降级: ${String(result.fallbackReason)}`);
    }

    return parts.join('；') || String(result.message || '抠图完成');
}

export const matteProductExecutor: SkillExecutor = {
    skillId: 'matte-product',
    
    async execute({ params, callbacks }: SkillExecuteParams): Promise<AgentResult> {
        callbacks?.onProgress?.('准备智能抠图参数', 8);
        callbacks?.onMessage?.('正在执行智能抠图。');
        emitSkillStep(callbacks, {
            kind: 'observation',
            title: '准备抠图参数',
            detail: summarizeMattingParams(params),
            status: 'running',
            toolName: 'matte-product',
            percent: 12
        });
        
        callbacks?.onProgress?.('正在调用 Photoshop 抠图工具', 36);
        const matteResult = await executeObservedSkillTool(
            callbacks,
            'removeBackground',
            params,
            executeToolCall,
            summarizeMattingParams(params)
        );

        const success = matteResult?.success ?? false;
        emitSkillStep(callbacks, {
            kind: 'verification',
            title: success ? '抠图结果已返回' : '抠图未完成',
            detail: summarizeMattingResult(matteResult),
            status: success ? 'success' : 'error',
            toolName: 'removeBackground',
            percent: success ? 88 : 82,
            issue: success ? undefined : String(matteResult?.error || matteResult?.message || 'matting_failed')
        });
        callbacks?.onProgress?.(success ? '抠图完成' : '抠图失败', success ? 100 : 90);
        
        return {
            success,
            message: success ? '抠图完成' : `抠图失败: ${matteResult?.error || matteResult?.message || '未知错误'}`,
            toolResults: [matteResult]
        };
    }
};
