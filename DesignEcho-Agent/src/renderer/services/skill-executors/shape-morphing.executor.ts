/**
 * 形态统一技能执行器
 */

import type { SkillExecutor, SkillExecuteParams } from './types';
import type { AgentResult } from '../unified-agent.service';

export const shapeMorphingExecutor: SkillExecutor = {
    skillId: 'shape-morphing',
    
    async execute({ params, callbacks }: SkillExecuteParams): Promise<AgentResult> {
        callbacks?.onMessage?.('🔄 当前形态统一仅支持 UXP 面板主链...');
        return {
            success: false,
            message: '形态统一当前只支持从 UXP 面板触发的 enhanced-shape-morph 主链，旧的 morphToShape/batchMorphToShape 路径已不再作为正式执行入口。'
        };
    }
};
