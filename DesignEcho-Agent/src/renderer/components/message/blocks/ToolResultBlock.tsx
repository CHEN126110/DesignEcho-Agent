/**
 * 工具结果块渲染组件
 */

import React, { useState } from 'react';
import type { ToolResultBlock as ToolResultBlockType } from '../types';
import { sanitizeUserVisibleDiagnosticText } from '../../../../shared/chat-response-cleaner';

interface ToolResultBlockProps {
    block: ToolResultBlockType;
    onAction?: (actionId: string, params?: Record<string, any>) => void;
    collapseForTerminalState?: boolean;
}

export const ToolResultBlock: React.FC<ToolResultBlockProps> = ({
    block,
    onAction,
    collapseForTerminalState = false
}) => {
    const [isExpanded, setIsExpanded] = useState(
        collapseForTerminalState ? false : block.success === false
    );
    
    const statusIcon = block.success ? '✓' : '✗';
    const statusClass = block.success ? 'success' : 'error';
    
    const formatDuration = (ms?: number) => {
        if (!ms) return null;
        if (ms < 1000) return `${ms}ms`;
        return `${(ms / 1000).toFixed(1)}s`;
    };
    
    const formatResultValue = (value: any): string => {
        if (value === null || value === undefined) return '-';
        if (typeof value === 'boolean') return value ? '是' : '否';
        if (typeof value === 'number') return value.toLocaleString();
        if (typeof value === 'string') {
            const trimmed = value.trim();
            if ((trimmed.startsWith('{') || trimmed.startsWith('[')) && trimmed.length > 80) {
                return '结构化结果已隐藏。';
            }
            const cleaned = sanitizeUserVisibleDiagnosticText(value).replace(/工具调用/g, '画面处理') || '这项结果包含结构化内容，已收起。';
            return cleaned.length > 1000 ? `${cleaned.slice(0, 1000)}...` : cleaned;
        }
        if (Array.isArray(value)) return `${value.length} 项`;
        if (typeof value === 'object') return '对象数据已隐藏。';
        return String(value);
    };

    const safeErrorText = sanitizeUserVisibleDiagnosticText(block.error) || '处理失败';
    const safeDetailLabel = (label: unknown): string => {
        const cleaned = sanitizeUserVisibleDiagnosticText(String(label ?? ''));
        if (!cleaned || cleaned.includes('系统已保留诊断信息')) return '详情';
        return cleaned;
    };
    const safeDetailValue = (value: any): string => formatResultValue(value);
    const isSafeExternalLink = (value: string): boolean => /^https?:\/\//i.test(value);
    
    return (
        <div className={`message-block tool-result-block ${statusClass}`}>
            {/* 头部 */}
            <div className="tool-result-header" onClick={() => setIsExpanded(!isExpanded)}>
                <div className="tool-info">
                    <span className="tool-icon">{block.icon}</span>
                    <span className="tool-name">{block.displayName}</span>
                    <span className={`status-badge ${statusClass}`}>
                        {statusIcon} {block.success ? '成功' : '失败'}
                    </span>
                </div>
                <div className="tool-meta">
                    {block.duration && (
                        <span className="tool-duration">{formatDuration(block.duration)}</span>
                    )}
                    <button className="expand-btn" aria-label={isExpanded ? '收起结果' : '展开结果'}>
                        <svg 
                            width="16" 
                            height="16" 
                            viewBox="0 0 24 24" 
                            fill="none" 
                            stroke="currentColor" 
                            strokeWidth="2"
                            style={{ transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
                        >
                            <polyline points="6 9 12 15 18 9"></polyline>
                        </svg>
                    </button>
                </div>
            </div>
            
            {/* 详情 */}
            {isExpanded && (
                <div className="tool-result-details">
                    {/* 错误信息 */}
                    {block.error && (
                        <div className="error-message">
                            <span className="error-icon">!</span>
                            <span className="error-text">{safeErrorText}</span>
                        </div>
                    )}
                    
                    {/* 详情列表 */}
                    {block.details && block.details.length > 0 && (
                        <div className="details-list">
                            {block.details.map((detail, index) => {
                                const detailLabel = safeDetailLabel(detail.label);
                                const detailValue = safeDetailValue(detail.value);
                                const rawLinkValue = String(detail.value || '').trim();
                                const canRenderLink = detail.type === 'link'
                                    && isSafeExternalLink(rawLinkValue)
                                    && detailValue === rawLinkValue;
                                return (
                                    <div key={index} className="detail-item">
                                        <span className="detail-label">{detailLabel}:</span>
                                        <span className={`detail-value ${detail.type || 'text'}`}>
                                            {detail.type === 'code' ? (
                                                <code>{detailValue}</code>
                                            ) : canRenderLink ? (
                                                <a href={rawLinkValue} target="_blank" rel="noopener">
                                                    {detailValue}
                                                </a>
                                            ) : (
                                                detailValue
                                            )}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                    
                    {/* 原始结果 */}
                    {block.result && !block.details && (
                        <div className="raw-result">
                            <pre>{formatResultValue(block.result)}</pre>
                        </div>
                    )}
                    
                    {/* 操作按钮 */}
                    {block.actions && block.actions.length > 0 && (
                        <div className="action-buttons">
                            {block.actions.map(action => (
                                <button
                                    key={action.id}
                                    className={`action-btn ${action.variant || 'secondary'}`}
                                    disabled={action.disabled || action.loading}
                                    onClick={() => onAction?.(action.action, action.params)}
                                >
                                    {action.loading && <span className="btn-spinner"></span>}
                                    {action.icon && <span className="btn-icon">{action.icon}</span>}
                                    <span className="btn-label">{action.label}</span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default ToolResultBlock;
