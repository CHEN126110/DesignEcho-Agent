/**
 * 顶部导航栏
 */

import React, { useState } from 'react';

interface HeaderProps {
    isConnected: boolean;
    onSettingsClick: () => void;
    projectName?: string;
    onCloseProject?: () => void;
    isHome?: boolean;
    workspaceNavigation?: React.ReactNode;
}

export const Header: React.FC<HeaderProps> = ({ 
    isConnected, 
    onSettingsClick, 
    projectName, 
    onCloseProject,
    isHome,
    workspaceNavigation
}) => {
    const [isUndoing, setIsUndoing] = useState(false);
    const [isRedoing, setIsRedoing] = useState(false);

    const handleUndo = async () => {
        if (!isConnected || isUndoing) return;
        setIsUndoing(true);
        try {
            await window.designEcho?.sendToPlugin('undo', {});
        } catch (error) {
            console.error('Undo failed:', error);
        } finally {
            setIsUndoing(false);
        }
    };

    const handleRedo = async () => {
        if (!isConnected || isRedoing) return;
        setIsRedoing(true);
        try {
            await window.designEcho?.sendToPlugin('redo', {});
        } catch (error) {
            console.error('Redo failed:', error);
        } finally {
            setIsRedoing(false);
        }
    };

    return (
        <header className={`app-header ${workspaceNavigation ? 'with-workspace-tabs' : ''}`}>
            <div className="header-left">
                {/* 返回按钮（项目模式下显示） */}
                {projectName && onCloseProject && (
                    <button 
                        className="back-btn" 
                        onClick={onCloseProject}
                        title="返回项目列表"
                    >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                            <path d="M15 18l-6-6 6-6" />
                        </svg>
                    </button>
                )}

                <div className="logo">
                    <span className="logo-text">DesignEcho</span>
                    {projectName && <span className="project-context">{projectName}</span>}
                </div>
            </div>

            {workspaceNavigation && (
                <div className="header-workspace-navigation">
                    {workspaceNavigation}
                </div>
            )}

            {/* 撤销/重做按钮（仅在项目模式下显示） */}
            {!isHome && (
                <div className="history-buttons">
                    <button 
                        className="history-btn" 
                        onClick={handleUndo} 
                        disabled={!isConnected || isUndoing}
                        title="撤销 (Ctrl+Z)"
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M3 7v6h6" />
                            <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
                        </svg>
                    </button>
                    <button 
                        className="history-btn" 
                        onClick={handleRedo} 
                        disabled={!isConnected || isRedoing}
                        title="重做 (Ctrl+Shift+Z)"
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M21 7v6h-6" />
                            <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7" />
                        </svg>
                    </button>
                </div>
            )}

            <div className="header-center">
                <div className={`connection-badge ${!isConnected ? 'waiting' : ''}`}>
                    <span className={`status-dot ${isConnected ? 'connected' : 'disconnected'}`} />
                    <span className="connection-text">{isConnected ? 'Photoshop 已连接' : '等待 Photoshop 连接…'}</span>
                    {!isConnected && (
                        <span className="connection-hint">请在 PS 中打开插件面板</span>
                    )}
                </div>
            </div>

            <div className="header-right">
                <button className="header-settings-btn" onClick={onSettingsClick} aria-label="打开设置" title="设置">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="3" />
                        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                    </svg>
                </button>
            </div>

            <style>{`
                .app-header {
                    position: relative;
                    z-index: 40;
                    display: flex;
                    align-items: center;
                    height: 52px;
                    padding: 0 18px;
                    background: var(--de-bg);
                    border-bottom: 1px solid var(--de-border-subtle);
                    -webkit-app-region: drag;
                }

                .header-left {
                    min-width: 0;
                    display: flex;
                    align-items: center;
                    padding: 0;
                    box-sizing: border-box;
                    -webkit-app-region: no-drag;
                    flex-shrink: 0;
                    height: 100%;
                }

                .header-right {
                    display: flex;
                    align-items: center;
                    justify-content: flex-end;
                    -webkit-app-region: no-drag;
                    flex-shrink: 0;
                }

                .header-workspace-navigation {
                    display: flex;
                    min-width: 0;
                    height: 100%;
                    margin-left: 18px;
                    align-items: flex-end;
                    flex: 1;
                    -webkit-app-region: no-drag;
                }

                .logo {
                    display: flex;
                    align-items: center;
                    gap: 14px;
                    flex-shrink: 0;
                    white-space: nowrap;
                    overflow: hidden;
                }

                .logo-text {
                    color: var(--de-text-primary);
                    font-size: 13px;
                    font-weight: 500;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    max-width: 160px;
                }

                .project-context {
                    max-width: 180px;
                    overflow: hidden;
                    color: var(--de-text-muted);
                    font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
                    font-size: 9.5px;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }

                .header-center {
                    flex: 1;
                    display: flex;
                    align-items: center;
                    justify-content: flex-end;
                    padding-right: 8px;
                }

                .app-header.with-workspace-tabs .header-center {
                    flex: 0 0 auto;
                    padding-left: 14px;
                }

                .connection-badge {
                    display: flex;
                    align-items: center;
                    gap: 7px;
                    padding: 0;
                    background: transparent;
                    border: 0;
                    font-size: 10px;
                }

                .connection-text {
                    color: var(--de-text-muted);
                }

                .connection-badge.waiting {
                    animation: pulse 2s ease-in-out infinite;
                }

                .connection-badge.waiting .status-dot {
                    animation: blink 1s ease-in-out infinite;
                }

                @keyframes pulse {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0.7; }
                }

                @keyframes blink {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0.3; }
                }

                .connection-hint {
                    display: none;
                    color: var(--de-text-secondary);
                    opacity: 0.7;
                    margin-left: 4px;
                }

                .history-buttons {
                    display: none;
                    gap: 4px;
                    padding: 0 10px;
                    align-items: center;
                    flex-shrink: 0;
                }

                .history-btn {
                    width: 28px;
                    height: 28px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: transparent;
                    border: 1px solid transparent;
                    border-radius: 6px;
                    color: var(--de-text);
                    cursor: pointer;
                    transition: all 0.2s;
                }

                .history-btn:hover:not(:disabled) {
                    background: var(--de-primary);
                    border-color: var(--de-primary);
                    color: white;
                }

                .history-btn:disabled {
                    opacity: 0.4;
                    cursor: not-allowed;
                }

                .back-btn {
                    width: 26px;
                    height: 26px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: transparent;
                    border: 1px solid transparent;
                    border-radius: 6px;
                    color: var(--de-text);
                    cursor: pointer;
                    transition: all 0.2s;
                    margin-right: 8px;
                    flex-shrink: 0;
                }

                .back-btn:hover {
                    background: var(--de-hover-bg);
                    color: var(--de-text-primary);
                }

                .header-settings-btn {
                    display: flex;
                    width: 28px;
                    height: 28px;
                    padding: 0;
                    align-items: center;
                    justify-content: center;
                    border: 0;
                    border-radius: 6px;
                    background: transparent;
                    color: var(--de-text-muted);
                    cursor: pointer;
                }

                .header-settings-btn svg {
                    width: 15px;
                    height: 15px;
                    stroke-width: 1.6;
                }

                .header-settings-btn:hover {
                    background: var(--de-hover-bg);
                    color: var(--de-text-primary);
                }

            `}</style>
        </header>
    );
};
