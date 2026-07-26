/**
 * 智能布局技能执行器
 */

import type { SkillExecutor, SkillExecuteParams } from './types';
import type { AgentResult } from '../unified-agent.service';
import { executeToolCall } from '../tool-executor.service';
import { emitSkillStep, executeObservedSkillTool } from './skill-step-events';

export const smartLayoutExecutor: SkillExecutor = {
    skillId: 'smart-layout',
    
    async execute({ params, callbacks }: SkillExecuteParams): Promise<AgentResult> {
        callbacks?.onProgress?.('准备智能布局参数', 12);
        callbacks?.onMessage?.('正在执行智能布局。');
        emitSkillStep(callbacks, {
            kind: 'observation',
            title: '准备智能布局参数',
            detail: `参数字段: ${Object.keys(params || {}).sort().join(', ') || '无'}`,
            status: 'running',
            percent: 12
        });
        
        callbacks?.onProgress?.('调用 Photoshop 智能布局工具', 42);
        const layoutResult = await executeObservedSkillTool(
            callbacks,
            'smartLayout',
            params,
            executeToolCall,
            '执行 Photoshop 侧智能布局工具；本步骤只记录工具调用，不改变布局算法。'
        );
        const success = layoutResult?.success ?? false;
        emitSkillStep(callbacks, {
            kind: 'verification',
            title: success ? '智能布局结果已返回' : '智能布局未完成',
            detail: success ? (layoutResult?.message || '布局工具返回成功。') : (layoutResult?.error || layoutResult?.message || '未知错误'),
            status: success ? 'success' : 'error',
            toolName: 'smartLayout',
            percent: success ? 100 : 88,
            issue: success ? undefined : (layoutResult?.error || layoutResult?.message || 'smart_layout_failed')
        });
        
        return {
            success,
            message: success ? '布局调整完成' : `布局调整失败: ${layoutResult?.error || layoutResult?.message || '未知错误'}`,
            toolResults: [layoutResult]
        };
    }
};
