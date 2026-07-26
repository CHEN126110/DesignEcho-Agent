/**
 * 模型反馈 / 工具调用块。
 * 只展示已经进入消息记录的 provider thinking 和真实工具调用。
 */

import React, { useState } from 'react';
import type { ThinkingBlock as ThinkingBlockType } from '../types';
import {
    resolveThinkingStepDisplayRole,
    resolveThinkingStepRoleLabel,
    type ThinkingStepDisplayRole
} from '../thinkingStepPresentation';

interface ThinkingBlockProps {
    block: ThinkingBlockType;
    collapseForTerminalState?: boolean;
}

export const ThinkingBlock: React.FC<ThinkingBlockProps> = ({
    block,
    collapseForTerminalState = false
}) => {
    const [isExpanded, setIsExpanded] = useState(
        collapseForTerminalState ? false : block.isExpanded ?? false
    );

    const totalSteps = block.steps.length;
    const hasError = block.steps.some(s => s.status === 'error');

    const formatDuration = (ms?: number) => {
        if (!ms) return null;
        if (ms < 1000) return `${ms}ms`;
        return `${(ms / 1000).toFixed(1)}s`;
    };

    const validSteps = block.steps.filter(s => s.label || s.detail);

    if (validSteps.length === 0) return null;

    const getStepDisplayText = (step: ThinkingBlockType['steps'][0]) => {
        const genericLabels = ['完成', '成功', '失败', 'success', 'error', 'done'];
        if (step.detail && genericLabels.some(g => step.label?.toLowerCase().includes(g.toLowerCase()))) {
            return step.detail;
        }
        return step.label || step.detail || '';
    };

    const isActionStep = (step: ThinkingBlockType['steps'][0]) => step.tone === 'action';

    const getDisplayRole = (step: ThinkingBlockType['steps'][0]): ThinkingStepDisplayRole => (
        step.displayRole || resolveThinkingStepDisplayRole({
            type: step.sourceType,
            tone: step.tone
        })
    );

    const getActionLabel = (step: ThinkingBlockType['steps'][0]) => {
        if (step.actionLabel) return step.actionLabel;
        if (step.status === 'error') return '未完成';
        if (step.status === 'running' || step.status === 'pending') return '正在处理';
        return '已处理';
    };

    const getRoleLabel = (step: ThinkingBlockType['steps'][0], role: ThinkingStepDisplayRole): string => {
        if (step.roleLabel) return step.roleLabel;
        return resolveThinkingStepRoleLabel(role, step.sourceType);
    };

    return (
        <div className={`message-block thinking-block ${hasError ? 'has-error' : ''}`}>
            <div
                className="thinking-header"
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <div className="thinking-summary">
                    <span className="thinking-dot"></span>
                    <span className="thinking-label">{block.title || '处理中'}</span>
                    {totalSteps > 1 && (
                        <span className="thinking-progress">({totalSteps})</span>
                    )}
                    {block.totalDuration ? (
                        <span className="thinking-duration">
                            {formatDuration(block.totalDuration)}
                        </span>
                    ) : null}
                </div>
                <button className="expand-toggle">
                    <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        style={{
                            transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                            transition: 'transform 0.2s ease'
                        }}
                    >
                        <polyline points="6 9 12 15 18 9"></polyline>
                    </svg>
                </button>
            </div>

            {isExpanded && (
                <div className="thinking-steps">
                    {validSteps.map((step, index) => {
                        const displayRole = getDisplayRole(step);
                        const actionStep = isActionStep(step) || displayRole === 'action';
                        const roleLabel = getRoleLabel(step, displayRole);
                        return (
                            <div
                                key={step.id}
                                className={`thinking-step step-${step.status} ${actionStep ? 'thinking-step--action' : 'thinking-step--thought'} thinking-step--${displayRole}`}
                            >
                                <span className="step-number">
                                    {String(index + 1).padStart(2, '0')}
                                </span>
                                {actionStep && (
                                    <span className="step-action-marker">
                                        {getActionLabel(step)}
                                    </span>
                                )}
                                {!actionStep && displayRole !== 'reasoning' && (
                                    <span className="step-role-marker">
                                        {roleLabel}
                                    </span>
                                )}
                                <span className="step-text">
                                    {getStepDisplayText(step)}
                                    {step.detail && !getStepDisplayText(step).includes(step.detail) && (
                                        <span className="step-detail">{step.detail}</span>
                                    )}
                                    {actionStep && step.duration && (
                                        <span className="step-duration">
                                            {formatDuration(step.duration)}
                                        </span>
                                    )}
                                </span>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default ThinkingBlock;
