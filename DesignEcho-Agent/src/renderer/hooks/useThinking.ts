/**
 * 思维链状态管理 Hook
 * 
 * 从 ChatPanel.tsx 抽离的思维链相关逻辑
 */

import { useState, useCallback } from 'react';
import type { ThinkingStep } from '../components/ThinkingProcess';

export interface UseThinkingReturn {
    /** 思维步骤列表 */
    thinkingSteps: ThinkingStep[];
    /** 是否显示思维过程 */
    showThinking: boolean;
    /** 设置显示状态 */
    setShowThinking: (show: boolean) => void;
    /** 添加思维步骤 */
    addThinkingStep: (step: Omit<ThinkingStep, 'id' | 'timestamp'>) => string;
    /** 更新思维步骤 */
    updateThinkingStep: (stepId: string, updates: Partial<ThinkingStep>) => void;
    /** 清除思维步骤 */
    clearThinkingSteps: (hideThinking?: boolean) => void;
}

/**
 * 思维链状态管理
 */
export function useThinking(): UseThinkingReturn {
    const [thinkingSteps, setThinkingSteps] = useState<ThinkingStep[]>([]);
    const [showThinking, setShowThinking] = useState(false);

    const addThinkingStep = useCallback((step: Omit<ThinkingStep, 'id' | 'timestamp'>): string => {
        const newStep: ThinkingStep = {
            ...step,
            id: `step-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            timestamp: Date.now()
        };
        setThinkingSteps(prev => [...prev, newStep]);
        return newStep.id;
    }, []);

    const updateThinkingStep = useCallback((stepId: string, updates: Partial<ThinkingStep>) => {
        setThinkingSteps(prev => prev.map(step => 
            step.id === stepId ? { ...step, ...updates } : step
        ));
    }, []);

    const clearThinkingSteps = useCallback((hideThinking: boolean = true) => {
        setThinkingSteps([]);
        if (hideThinking) {
            setShowThinking(false);
        }
    }, []);

    return {
        thinkingSteps,
        showThinking,
        setShowThinking,
        addThinkingStep,
        updateThinkingStep,
        clearThinkingSteps
    };
}
