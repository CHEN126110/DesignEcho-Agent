/**
 * 侧边栏 - 对话列表
 */

import React, { useState } from 'react';
import { useAppStore } from '../stores/app.store';

// 确认对话框组件
const ConfirmDialog: React.FC<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    onCancel: () => void;
    confirmText?: string;
    cancelText?: string;
    type?: 'danger' | 'warning' | 'info';
}> = ({ isOpen, title, message, onConfirm, onCancel, confirmText = '确定', cancelText = '取消', type = 'danger' }) => {
    if (!isOpen) return null;

    return (
        <div className="confirm-dialog-overlay" onClick={onCancel}>
            <div className="confirm-dialog" onClick={e => e.stopPropagation()}>
                <div className="confirm-dialog-header">
                    <div className={`confirm-dialog-icon ${type}`}>
                        {type === 'danger' && (
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <circle cx="12" cy="12" r="10"></circle>
                                <line x1="15" y1="9" x2="9" y2="15"></line>
                                <line x1="9" y1="9" x2="15" y2="15"></line>
                            </svg>
                        )}
                        {type === 'warning' && (
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                                <line x1="12" y1="9" x2="12" y2="13"></line>
                                <line x1="12" y1="17" x2="12.01" y2="17"></line>
                            </svg>
                        )}
                    </div>
                    <h3 className="confirm-dialog-title">{title}</h3>
                </div>
                <p className="confirm-dialog-message">{message}</p>
                <div className="confirm-dialog-actions">
                    <button className="confirm-dialog-btn cancel" onClick={onCancel}>
                        {cancelText}
                    </button>
                    <button className={`confirm-dialog-btn confirm ${type}`} onClick={onConfirm}>
                        {confirmText}
                    </button>
                </div>
            </div>

            <style>{`
                .confirm-dialog-overlay {
                    position: fixed;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background: rgba(0, 0, 0, 0.6);
                    backdrop-filter: blur(4px);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 10000;
                    animation: fadeIn 0.15s ease;
                }

                @keyframes fadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }

                @keyframes slideIn {
                    from { 
                        opacity: 0;
                        transform: scale(0.95) translateY(-10px);
                    }
                    to { 
                        opacity: 1;
                        transform: scale(1) translateY(0);
                    }
                }

                .confirm-dialog {
                    background: linear-gradient(145deg, #1a1a2e 0%, #16162a 100%);
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    border-radius: 16px;
                    padding: 24px;
                    min-width: 320px;
                    max-width: 400px;
                    box-shadow: 
                        0 25px 50px -12px rgba(0, 0, 0, 0.5),
                        0 0 0 1px rgba(255, 255, 255, 0.05),
                        inset 0 1px 0 rgba(255, 255, 255, 0.05);
                    animation: slideIn 0.2s ease;
                }

                .confirm-dialog-header {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    margin-bottom: 12px;
                }

                .confirm-dialog-icon {
                    width: 40px;
                    height: 40px;
                    border-radius: 10px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    flex-shrink: 0;
                }

                .confirm-dialog-icon.danger {
                    background: rgba(239, 68, 68, 0.15);
                    color: #ef4444;
                }

                .confirm-dialog-icon.warning {
                    background: rgba(245, 158, 11, 0.15);
                    color: #f59e0b;
                }

                .confirm-dialog-icon.info {
                    background: rgba(99, 102, 241, 0.15);
                    color: #6366f1;
                }

                .confirm-dialog-title {
                    margin: 0;
                    font-size: 16px;
                    font-weight: 600;
                    color: #f1f5f9;
                    font-family: 'Inter', -apple-system, sans-serif;
                }

                .confirm-dialog-message {
                    margin: 0 0 20px 0;
                    font-size: 14px;
                    color: #94a3b8;
                    line-height: 1.5;
                    padding-left: 52px;
                }

                .confirm-dialog-actions {
                    display: flex;
                    gap: 12px;
                    justify-content: flex-end;
                }

                .confirm-dialog-btn {
                    padding: 10px 20px;
                    border-radius: 8px;
                    font-size: 14px;
                    font-weight: 500;
                    cursor: pointer;
                    transition: all 0.2s ease;
                    border: none;
                    font-family: 'Inter', -apple-system, sans-serif;
                }

                .confirm-dialog-btn.cancel {
                    background: rgba(255, 255, 255, 0.05);
                    color: #94a3b8;
                    border: 1px solid rgba(255, 255, 255, 0.1);
                }

                .confirm-dialog-btn.cancel:hover {
                    background: rgba(255, 255, 255, 0.1);
                    color: #f1f5f9;
                }

                .confirm-dialog-btn.confirm.danger {
                    background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
                    color: white;
                }

                .confirm-dialog-btn.confirm.danger:hover {
                    background: linear-gradient(135deg, #f87171 0%, #ef4444 100%);
                    transform: translateY(-1px);
                    box-shadow: 0 4px 12px rgba(239, 68, 68, 0.3);
                }

                .confirm-dialog-btn.confirm.warning {
                    background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
                    color: white;
                }

                .confirm-dialog-btn.confirm.warning:hover {
                    background: linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%);
                }

                .confirm-dialog-btn.confirm.info {
                    background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%);
                    color: white;
                }

                .confirm-dialog-btn.confirm.info:hover {
                    background: linear-gradient(135deg, #818cf8 0%, #6366f1 100%);
                }
            `}</style>
        </div>
    );
};

export const Sidebar: React.FC = () => {
    const { 
        conversations, 
        currentConversationId, 
        createConversation, 
        deleteConversation,
        switchConversation
    } = useAppStore();
    
    const [hoveredId, setHoveredId] = useState<string | null>(null);
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

    const handleNewChat = () => {
        createConversation();
    };

    const handleDeleteClick = (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        // 如果只有一个对话，显示确认对话框
        if (conversations.length <= 1) {
            setPendingDeleteId(id);
            setDeleteDialogOpen(true);
        } else {
            // 多个对话直接删除
            deleteConversation(id);
        }
    };

    const handleConfirmDelete = () => {
        if (pendingDeleteId) {
            deleteConversation(pendingDeleteId);
        }
        setDeleteDialogOpen(false);
        setPendingDeleteId(null);
    };

    const handleCancelDelete = () => {
        setDeleteDialogOpen(false);
        setPendingDeleteId(null);
    };

    const formatTime = (timestamp: number) => {
        const date = new Date(timestamp);
        const now = new Date();
        const isToday = date.toDateString() === now.toDateString();
        
        if (isToday) {
            return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
        }
        return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
    };

    return (
        <aside className="sidebar">
            {/* 确认删除对话框 */}
            <ConfirmDialog
                isOpen={deleteDialogOpen}
                title="删除对话"
                message="确定要删除这个对话吗？删除后将无法恢复。"
                onConfirm={handleConfirmDelete}
                onCancel={handleCancelDelete}
                confirmText="删除"
                cancelText="取消"
                type="danger"
            />

            {/* 新建对话按钮 */}
            <div className="sidebar-header">
                <button className="new-chat-btn" onClick={handleNewChat}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="12" y1="5" x2="12" y2="19"></line>
                        <line x1="5" y1="12" x2="19" y2="12"></line>
                    </svg>
                    新建对话
                </button>
            </div>

            {/* 对话列表 */}
            <div className="conversation-list">
                {conversations.length === 0 ? (
                    <div className="empty-state">
                        <p>暂无对话</p>
                        <p className="hint">点击上方按钮开始</p>
                    </div>
                ) : (
                    conversations.map(conv => (
                        <div
                            key={conv.id}
                            className={`conversation-item ${conv.id === currentConversationId ? 'active' : ''}`}
                            onClick={() => switchConversation(conv.id)}
                            onMouseEnter={() => setHoveredId(conv.id)}
                            onMouseLeave={() => setHoveredId(null)}
                        >
                            <div className="conv-icon">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                                </svg>
                            </div>
                            <div className="conv-info">
                                <span className="conv-title">{conv.title}</span>
                                <span className="conv-time">{formatTime(conv.updatedAt)}</span>
                            </div>
                            {(hoveredId === conv.id || conv.id === currentConversationId) && (
                        <button
                                    className="delete-btn"
                                    onClick={(e) => handleDeleteClick(e, conv.id)}
                                    title="删除对话"
                                >
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <polyline points="3 6 5 6 21 6"></polyline>
                                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                                    </svg>
                        </button>
                            )}
                </div>
                    ))
                )}
            </div>

            <style>{`
                .sidebar {
                    width: 260px;
                    min-width: 260px;
                    background: var(--de-bg-card);
                    border-right: 1px solid var(--de-border);
                    display: flex;
                    flex-direction: column;
                    overflow: hidden;
                }

                .sidebar-header {
                    padding: 16px;
                    border-bottom: 1px solid var(--de-border);
                }

                .new-chat-btn {
                    width: 100%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 8px;
                    padding: 12px 16px;
                    background: var(--de-primary);
                    border: none;
                    border-radius: 8px;
                    color: white;
                    font-size: 14px;
                    font-weight: 500;
                    cursor: pointer;
                    transition: all 0.2s ease;
                }

                .new-chat-btn:hover {
                    background: var(--de-primary-hover);
                    transform: translateY(-1px);
                }

                .conversation-list {
                    flex: 1;
                    overflow-y: auto;
                    padding: 8px;
                }

                .empty-state {
                    text-align: center;
                    padding: 40px 20px;
                    color: var(--de-text-secondary);
                }

                .empty-state p {
                    margin: 0;
                }

                .empty-state .hint {
                    font-size: 12px;
                    margin-top: 8px;
                    opacity: 0.7;
                }

                .conversation-item {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    padding: 10px 12px;
                    border-radius: 8px;
                    cursor: pointer;
                    transition: all 0.15s ease;
                    position: relative;
                    margin-bottom: 4px;
                }

                .conversation-item:hover {
                    background: var(--de-hover-bg, rgba(0, 0, 0, 0.05));
                }
                
                [data-theme="dark"] .conversation-item:hover {
                    background: rgba(255, 255, 255, 0.05);
                }

                .conversation-item.active {
                    background: rgba(var(--de-primary-rgb), 0.15);
                    border: 1px solid rgba(var(--de-primary-rgb), 0.3);
                }

                .conv-icon {
                    width: 32px;
                    height: 32px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: var(--de-bg-light);
                    border-radius: 6px;
                    color: var(--de-text-secondary);
                    flex-shrink: 0;
                }

                .conv-info {
                    flex: 1;
                    min-width: 0;
                    display: flex;
                    flex-direction: column;
                    gap: 2px;
                }

                .conv-title {
                    font-size: 13px;
                    font-weight: 500;
                    color: var(--de-text);
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }

                .conv-time {
                    font-size: 11px;
                    color: var(--de-text-secondary);
                }

                .delete-btn {
                    width: 28px;
                    height: 28px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: transparent;
                    border: none;
                    border-radius: 6px;
                    color: var(--de-text-secondary);
                    cursor: pointer;
                    opacity: 0.6;
                    transition: all 0.15s ease;
                    flex-shrink: 0;
                }

                .delete-btn:hover {
                    background: rgba(239, 68, 68, 0.2);
                    color: #ef4444;
                    opacity: 1;
                }

            `}</style>
        </aside>
    );
};
