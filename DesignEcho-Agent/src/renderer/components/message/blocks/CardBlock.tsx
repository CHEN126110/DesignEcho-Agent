/**
 * 卡片块渲染组件
 */

import React, { useState } from 'react';
import type { CardBlock as CardBlockType } from '../types';

interface CardBlockProps {
    block: CardBlockType;
    onAction?: (actionId: string, params?: Record<string, any>) => void;
}

const VARIANT_CONFIG = {
    info: {
        icon: 'i',
        className: 'card-info',
        defaultTitle: '提示'
    },
    success: {
        icon: '✓',
        className: 'card-success',
        defaultTitle: '成功'
    },
    warning: {
        icon: '!',
        className: 'card-warning',
        defaultTitle: '警告'
    },
    error: {
        icon: 'x',
        className: 'card-error',
        defaultTitle: '错误'
    },
    neutral: {
        icon: 'i',
        className: 'card-neutral',
        defaultTitle: '信息'
    }
};

export const CardBlock: React.FC<CardBlockProps> = ({ block, onAction }) => {
    const [isCollapsed, setIsCollapsed] = useState(block.defaultCollapsed ?? false);
    
    const config = VARIANT_CONFIG[block.variant];
    const icon = block.icon || config.icon;
    const title = block.title || config.defaultTitle;
    
    return (
        <div className={`message-block card-block ${config.className}`}>
            {/* 卡片头部 */}
            <div 
                className="card-header"
                onClick={() => block.collapsible && setIsCollapsed(!isCollapsed)}
                style={{ cursor: block.collapsible ? 'pointer' : 'default' }}
            >
                <div className="card-title-row">
                    <span className="card-icon">{icon}</span>
                    <span className="card-title">{title}</span>
                </div>
                {block.collapsible && (
                    <button className="collapse-btn" aria-label={isCollapsed ? '展开' : '收起'}>
                        <svg 
                            width="16" 
                            height="16" 
                            viewBox="0 0 24 24" 
                            fill="none" 
                            stroke="currentColor" 
                            strokeWidth="2"
                            style={{ transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}
                        >
                            <polyline points="6 9 12 15 18 9"></polyline>
                        </svg>
                    </button>
                )}
            </div>
            
            {/* 卡片内容 */}
            {!isCollapsed && (
                <div className="card-body">
                    {/* 主要内容 */}
                    <div className="card-content">{block.content}</div>
                    
                    {/* 详情列表 */}
                    {block.details && block.details.length > 0 && (
                        <div className="card-details">
                            {block.details.map((detail, index) => (
                                <div key={index} className="card-detail-item">
                                    <span className="detail-label">{detail.label}</span>
                                    <span className="detail-value">{detail.value}</span>
                                </div>
                            ))}
                        </div>
                    )}
                    
                    {/* 操作按钮 */}
                    {block.actions && block.actions.length > 0 && (
                        <div className="card-actions">
                            {block.actions.map(action => (
                                <button
                                    key={action.id}
                                    className={`card-action-btn ${action.variant || 'secondary'}`}
                                    disabled={action.disabled || action.loading}
                                    onClick={() => onAction?.(action.action, action.params)}
                                >
                                    {action.loading && <span className="btn-spinner"></span>}
                                    {action.icon && <span className="btn-icon">{action.icon}</span>}
                                    <span>{action.label}</span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default CardBlock;
