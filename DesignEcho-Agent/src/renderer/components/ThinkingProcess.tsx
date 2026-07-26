import React from 'react';
import './ThinkingProcess.css';
import {
    getToolDisplayInfo,
    TOOL_NAME_MAP,
    type ToolDisplayInfo
} from '../services/tool-display-info';
import {
    resolveThinkingStepDisplayRole,
    resolveThinkingStepRoleLabel,
    cleanInlineProcessText,
    type ThinkingStepDisplayRole
} from './message/thinkingStepPresentation';

export { getToolDisplayInfo, TOOL_NAME_MAP, type ToolDisplayInfo };

export interface ThinkingStep {
    id: string;
    type: 'thinking' | 'status' | 'tool_call' | 'tool_result' | 'decision' | 'reading' | 'exploring' | 'analyzing';
    content: string;
    toolName?: string;
    toolParams?: unknown;
    toolResult?: unknown;
    imageData?: string;
    status: 'pending' | 'running' | 'success' | 'error';
    timestamp: number;
    duration?: number;
    filePath?: string;
    lineRange?: string;
}

interface ThinkingProcessProps {
    steps: ThinkingStep[];
    isExpanded?: boolean;
    onToggle?: () => void;
    className?: string;
}

const VISIBLE_STEP_TYPES = new Set<ThinkingStep['type']>([
    'thinking',
    'status',
    'decision',
    'reading',
    'exploring',
    'analyzing',
    'tool_call',
    'tool_result'
]);

function isActionStep(step: ThinkingStep): boolean {
    return step.type === 'tool_call' || step.type === 'tool_result';
}

function getDisplayRole(step: ThinkingStep): ThinkingStepDisplayRole {
    return resolveThinkingStepDisplayRole({
        type: step.type,
        toolName: step.toolName,
        tone: isActionStep(step) ? 'action' : 'thought'
    });
}

function getActionLabel(step: ThinkingStep): string {
    if (step.status === 'error') return '未完成';
    if (step.status === 'running' || step.status === 'pending') return '正在执行';
    return '已执行';
}

function resolveThinkingPanelTitle(panelSteps: ThinkingStep[]): string {
    const hasActiveStep = panelSteps.some((step) => step.status === 'running' || step.status === 'pending');
    const hasProcessStep = panelSteps.some((step) => step.type !== 'tool_call' && step.type !== 'tool_result');
    const hasToolStep = panelSteps.some((step) => step.type === 'tool_call' || step.type === 'tool_result');
    if (hasActiveStep && hasProcessStep && hasToolStep) return '正在思考与执行';
    if (hasActiveStep && hasProcessStep) return '正在思考';
    if (hasActiveStep && hasToolStep) return '正在执行';
    if (hasProcessStep && hasToolStep) return '思考与执行';
    if (hasProcessStep) return '思考';
    return '执行';
}

export const ThinkingProcess: React.FC<ThinkingProcessProps> = ({
    steps,
    className = ''
}) => {
    const validSteps = steps.filter((step) =>
        VISIBLE_STEP_TYPES.has(step.type)
        && typeof step.content === 'string'
        && step.content.trim().length > 0
    );
    if (validSteps.length === 0) {
        return null;
    }

    const getStepText = (step: ThinkingStep): string => {
        if ((step.type === 'tool_call' || step.type === 'tool_result') && step.toolName) {
            const info = getToolDisplayInfo(step.toolName);
            const raw = step.content || info.name;
            // 动作状态已由左侧时间线节点图标表达，文案去掉冗余的「执行」前缀，只留工具名（更清爽）。
            return cleanInlineProcessText(raw.replace(/^执行\s*/, '')) || info.name;
        }
        // 思考/观察文本剥离 markdown 标记与状态 emoji，避免裸标记与彩色 emoji 噪音。
        return cleanInlineProcessText(step.content);
    };

    const renderStepPanel = (title: string, panelSteps: ThinkingStep[]) => panelSteps.length > 0 ? (
        <div className={`thinking-simple ${className}`}>
            <div className="pondering-header">
                <span className="pondering-dot"></span>
                <span className="pondering-title">{title}</span>
                <span className="pondering-count">{panelSteps.length}</span>
            </div>

            <div className="pondering-steps">
                {panelSteps.map((step) => {
                    const displayRole = getDisplayRole(step);
                    const isTool = isActionStep(step) || displayRole === 'action';
                    // 语义标签不再以文字 pill 占据版面，转为可访问性属性（hover/读屏可见）；
                    // 步骤的类型与状态由左侧时间线节点的形状/颜色表达，正文按主次分级排版。
                    const semanticLabel = isTool
                        ? getActionLabel(step)
                        : resolveThinkingStepRoleLabel(displayRole, step.type);
                    return (
                        <div
                            key={step.id}
                            className={`pondering-step ${step.status} ${isTool ? 'is-action' : 'is-thought'} pondering-step--${displayRole}`}
                            title={semanticLabel}
                            aria-label={semanticLabel}
                        >
                            <span className="step-node" aria-hidden="true" />
                            <span className="step-text">{getStepText(step)}</span>
                            {step.imageData && (
                                <img
                                    className="step-snapshot"
                                    src={step.imageData.startsWith('data:')
                                        ? step.imageData
                                        : `data:image/jpeg;base64,${step.imageData}`}
                                    alt={getStepText(step)}
                                    loading="lazy"
                                />
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    ) : null;

    // 按原始时间顺序交替渲染：思考片段 → 它触发的工具 → 下一段思考 → 工具……（像 Claude 那样想一步做一步），
    // 而不是把思考全堆成一组、工具全堆成一组（旧版分两个面板渲染，导致思考和动作割裂、对不上）。
    return renderStepPanel(resolveThinkingPanelTitle(validSteps), validSteps);
};

export default ThinkingProcess;
