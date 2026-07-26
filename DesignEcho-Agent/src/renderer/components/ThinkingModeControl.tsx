import React, { useId } from 'react';
import { Lightbulb } from 'lucide-react';

import './ThinkingModeControl.css';

interface ThinkingModeControlProps {
    enabled: boolean;
    onToggle: () => void;
    direction?: 'up' | 'down';
    className?: string;
}

export const ThinkingModeControl: React.FC<ThinkingModeControlProps> = ({
    enabled,
    onToggle,
    direction = 'up',
    className = ''
}) => {
    const tooltipId = useId();

    return (
        <span className={`thinking-mode-control ${className}`.trim()}>
            <button
                type="button"
                className={`thinking-mode-control-button ${enabled ? 'active' : ''}`}
                data-testid="chat-thinking-toggle"
                aria-label={enabled ? '关闭 Thinking' : '开启 Thinking'}
                aria-describedby={tooltipId}
                aria-pressed={enabled}
                onClick={onToggle}
            >
                <Lightbulb size={16} strokeWidth={1.8} aria-hidden="true" />
            </button>
            <span
                id={tooltipId}
                role="tooltip"
                className={`thinking-mode-tooltip direction-${direction}`}
            >
                <strong>Thinking</strong>
                <span>自主规划复杂任务并交付成品</span>
            </span>
        </span>
    );
};
